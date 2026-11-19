import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, LessThanOrEqual, MoreThan, QueryFailedError, Repository } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { AcademicoService } from '../academico/academico.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { CreatePeriodoDto } from './dto/create-periodo.dto.js';
import { PeriodoResponseDto } from './dto/periodo-response.dto.js';
import type { TransicionPeriodoDto } from './dto/transicion-periodo.dto.js';
import { UpdatePeriodoDto } from './dto/update-periodo.dto.js';
import { PeriodoTitulacion } from './entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from './enums/periodo-estado.enum.js';
import { periodoResponse } from './periodo-response.mapper.js';
import { ReservaTemaService } from '../postulaciones/reserva-tema.service.js';

interface PostgresDriverError {
  code?: string;
}

export interface PagedPeriodos {
  data: PeriodoResponseDto[];
  total: number;
  page: number;
  limit: number;
}

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as PostgresDriverError;
  return driverError.code === '23505';
}

function assertCalendar(
  inicioPostulacion: Date,
  finPostulacion: Date,
  inicioTitulacion: Date,
): void {
  if (finPostulacion.getTime() <= inicioPostulacion.getTime()) {
    throw new BadRequestException(
      'La fecha fin de postulación debe ser posterior a su fecha de inicio.',
    );
  }
  if (inicioTitulacion.getTime() < finPostulacion.getTime()) {
    throw new BadRequestException(
      'La fecha de inicio de titulación debe ser igual o posterior al cierre de postulaciones.',
    );
  }
}

function datesFrom(dto: CreatePeriodoDto | UpdatePeriodoDto) {
  return {
    ...(dto.fecha_inicio_postulacion !== undefined
      ? { fecha_inicio_postulacion: new Date(dto.fecha_inicio_postulacion) }
      : {}),
    ...(dto.fecha_fin_postulacion !== undefined
      ? { fecha_fin_postulacion: new Date(dto.fecha_fin_postulacion) }
      : {}),
    ...(dto.fecha_inicio_titulacion !== undefined
      ? { fecha_inicio_titulacion: new Date(dto.fecha_inicio_titulacion) }
      : {}),
  };
}

/** El instante está dentro del plazo de postulación [inicio, fin). */
function enPlazoPostulacion(periodo: PeriodoTitulacion, now: Date): boolean {
  return now.getTime() >= periodo.fecha_inicio_postulacion.getTime()
    && now.getTime() < periodo.fecha_fin_postulacion.getTime();
}

/** El plazo de postulación ya venció (instante >= fecha fin). */
function plazoPostulacionVencido(periodo: PeriodoTitulacion, now: Date): boolean {
  return now.getTime() >= periodo.fecha_fin_postulacion.getTime();
}

/** Responsable de una transición: un usuario (flujo manual) o el sistema (por fechas). */
type ResponsableTransicion =
  | { actor: Usuario; ip: string | null; automatico: false }
  | { actor: null; ip: null; automatico: true };

const SISTEMA: ResponsableTransicion = { actor: null, ip: null, automatico: true };

/** Fecha ajustada por una transición forzada: se audita con su valor anterior y el motivo. */
export interface AjusteForzado {
  campo: 'fecha_inicio_postulacion' | 'fecha_fin_postulacion' | 'fecha_inicio_titulacion';
  anterior: Date;
  nuevo: Date;
  motivo: string;
}

/** Hora del servidor PostgreSQL: los disparadores comparan con `clock_timestamp()`, no con el reloj de Node. */
export async function ahoraBaseDatos(manager: EntityManager): Promise<Date> {
  const rows = await manager.query('SELECT clock_timestamp() AS ahora') as Array<{ ahora: Date | string }>;
  const value = rows[0]?.ahora;
  if (value === undefined) throw new ServiceUnavailableException('No se pudo leer la hora de PostgreSQL.');
  return new Date(value);
}

/** Motivo ya recortado de una transición forzada; el DTO lo exige y el servicio lo repite como defensa. */
export function motivoForzado(dto: TransicionPeriodoDto): string {
  const motivo = dto.motivo?.trim() ?? '';
  if (motivo.length < 10 || motivo.length > 500) {
    throw new BadRequestException('El motivo de una transición forzada debe tener entre 10 y 500 caracteres.');
  }
  return motivo;
}

export function valoresAnterioresAjuste(ajuste: AjusteForzado | null): Record<string, unknown> {
  return ajuste ? { [ajuste.campo]: ajuste.anterior } : {};
}

export function valoresNuevosAjuste(ajuste: AjusteForzado | null): Record<string, unknown> {
  return ajuste ? { [ajuste.campo]: ajuste.nuevo, forzado: true, motivo: ajuste.motivo } : {};
}

export interface CandidatosTransicionAutomatica {
  aperturas: string[];
  cierres: string[];
}

/**
 * En POSTULACION_CERRADA solo puede cambiar la fecha fin de postulación (para poder reabrir);
 * los demás campos se aceptan únicamente si repiten el valor actual.
 */
function assertOnlyEndDateChanges(current: PeriodoTitulacion, dto: UpdatePeriodoDto): void {
  const sameDate = (value: string | undefined, actual: Date) =>
    value === undefined || new Date(value).getTime() === actual.getTime();
  const unchanged =
    (dto.codigo === undefined || dto.codigo.trim() === current.codigo) &&
    (dto.nombre === undefined || dto.nombre.trim() === current.nombre) &&
    (dto.max_integrantes_default === undefined || dto.max_integrantes_default === current.max_integrantes_default) &&
    (dto.facultad_id === undefined || dto.facultad_id === current.facultad_id) &&
    sameDate(dto.fecha_inicio_postulacion, current.fecha_inicio_postulacion) &&
    sameDate(dto.fecha_inicio_titulacion, current.fecha_inicio_titulacion);
  if (!unchanged) {
    throw new ConflictException(
      'En POSTULACION_CERRADA solo se puede modificar la fecha fin de postulación.',
    );
  }
}

@Injectable()
export class PeriodosService {
  constructor(
    @InjectRepository(PeriodoTitulacion)
    private readonly repository: Repository<PeriodoTitulacion>,
    private readonly dataSource: DataSource,
    private readonly auditoria: AuditoriaService,
    private readonly academico: AcademicoService = new AcademicoService(),
    /** Opcional solo para pruebas unitarias; Nest siempre lo inyecta (PostulacionesPersistenciaModule). */
    private readonly reservas?: ReservaTemaService,
  ) {}

  async create(dto: CreatePeriodoDto): Promise<PeriodoResponseDto> {
    const dates = datesFrom(dto);
    assertCalendar(
      dates.fecha_inicio_postulacion!,
      dates.fecha_fin_postulacion!,
      dates.fecha_inicio_titulacion!,
    );
    await this.academico.buscarFacultad(this.dataSource, dto.facultad_id);

    try {
      const periodo = await this.repository.save(
        this.repository.create({
          codigo: dto.codigo.trim(),
          nombre: dto.nombre.trim(),
          ...dates,
          estado: PeriodoEstado.BORRADOR,
          max_integrantes_default: dto.max_integrantes_default,
          facultad_id: dto.facultad_id,
        }),
      );
      return await this.respuesta(periodo);
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  async list(query: PaginationQueryDto, incluirCondicionados = false): Promise<PagedPeriodos> {
    try {
      const [periodos, total] = await this.repository.findAndCount({
        order: { fecha_inicio_postulacion: 'DESC', id: 'ASC' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      const pendientes = incluirCondicionados
        ? await this.contarCondicionadosPendientes(periodos.map((periodo) => periodo.id))
        : null;
      const catalogo = await this.academico.catalogo(this.dataSource);
      return {
        data: periodos.map((periodo) => this.withPendientes(periodoResponse(periodo, catalogo), pendientes)),
        total,
        page: query.page,
        limit: query.limit,
      };
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  async getById(id: string, incluirCondicionados = false): Promise<PeriodoResponseDto> {
    try {
      const periodo = await this.repository.findOneBy({ id });
      if (!periodo) {
        throw new NotFoundException('No existe el período solicitado.');
      }
      const pendientes = incluirCondicionados ? await this.contarCondicionadosPendientes([periodo.id]) : null;
      return this.withPendientes(await this.respuesta(periodo), pendientes);
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  /** Cuenta, en una sola consulta agrupada, las habilitaciones CONDICIONADO/PENDIENTE por período. */
  private async contarCondicionadosPendientes(ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await this.dataSource.query(
      `SELECT "periodo_id", count(*)::int AS total FROM ${this.schema()}."estudiante_habilitado"
       WHERE "periodo_id" = ANY($1::uuid[]) AND "condicion_ingreso"='CONDICIONADO' AND "situacion_ingreso"='PENDIENTE'
       GROUP BY "periodo_id"`,
      [ids],
    ) as Array<{ periodo_id: string; total: number }>;
    return new Map(rows.map((row) => [row.periodo_id, Number(row.total)]));
  }

  private withPendientes(response: PeriodoResponseDto, pendientes: Map<string, number> | null): PeriodoResponseDto {
    return pendientes ? { ...response, condicionados_pendientes: pendientes.get(response.id) ?? 0 } : response;
  }

  private schema(): string {
    const value = (this.dataSource.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new ServiceUnavailableException('El esquema PostgreSQL configurado no es válido.');
    return `"${value}"`;
  }

  private async respuesta(periodo: PeriodoTitulacion): Promise<PeriodoResponseDto> {
    return periodoResponse(periodo, await this.academico.catalogo(this.dataSource));
  }

  async update(
    id: string,
    dto: UpdatePeriodoDto,
  ): Promise<PeriodoResponseDto> {
    if (!Object.values(dto).some((value) => value !== undefined)) {
      throw new BadRequestException('Debe indicar al menos un campo para editar.');
    }

    try {
      const periodo = await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(PeriodoTitulacion);
        const current = await repository.findOne({
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!current) {
          throw new NotFoundException('No existe el período solicitado.');
        }
        if (current.estado === PeriodoEstado.POSTULACION_CERRADA) {
          assertOnlyEndDateChanges(current, dto);
        } else if (current.estado !== PeriodoEstado.BORRADOR) {
          throw new ConflictException(
            'Solo se pueden editar períodos en BORRADOR; en POSTULACION_CERRADA solo la fecha fin de postulación.',
          );
        }
        if (dto.facultad_id !== undefined && dto.facultad_id !== current.facultad_id) {
          await this.academico.buscarFacultad(this.dataSource, dto.facultad_id);
          const rows = await manager.query(
            `SELECT count(*)::int AS total FROM ${this.schema()}."estudiante_habilitado" WHERE "periodo_id" = $1`,
            [id],
          ) as Array<{ total: number }>;
          if (Number(rows[0]?.total ?? 0) > 0) {
            throw new ConflictException('No se puede cambiar la facultad: el período ya tiene estudiantes habilitados.');
          }
        }

        const values = {
          ...(dto.codigo !== undefined ? { codigo: dto.codigo.trim() } : {}),
          ...(dto.nombre !== undefined ? { nombre: dto.nombre.trim() } : {}),
          ...datesFrom(dto),
          ...(dto.max_integrantes_default !== undefined
            ? { max_integrantes_default: dto.max_integrantes_default }
            : {}),
          ...(dto.facultad_id !== undefined ? { facultad_id: dto.facultad_id } : {}),
        };
        const next = { ...current, ...values };
        assertCalendar(
          next.fecha_inicio_postulacion,
          next.fecha_fin_postulacion,
          next.fecha_inicio_titulacion,
        );
        return repository.save(next);
      });
      return await this.respuesta(periodo);
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  async abrirPostulacion(
    id: string,
    dto: TransicionPeriodoDto,
    actor: Usuario,
    ip: string | null,
  ): Promise<PeriodoResponseDto> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const periodo = await this.bloquear(manager, id);
        if (!periodo) throw new NotFoundException('No existe el período solicitado.');
        const previous = periodo.estado;
        const reopening = previous === PeriodoEstado.POSTULACION_CERRADA;
        if (previous !== PeriodoEstado.BORRADOR && !reopening) {
          throw new ConflictException('Solo se pueden abrir períodos en BORRADOR o reabrir períodos en POSTULACION_CERRADA.');
        }
        let ajuste: AjusteForzado | null = null;
        if (dto.forzar === true) {
          const motivo = motivoForzado(dto);
          const ahora = await ahoraBaseDatos(manager);
          if (!enPlazoPostulacion(periodo, ahora)) {
            if (periodo.fecha_fin_postulacion.getTime() <= ahora.getTime()) {
              throw new ConflictException('No se puede forzar la apertura: la fecha fin de postulación ya pasó. Edita primero la fecha fin de postulación.');
            }
            ajuste = { campo: 'fecha_inicio_postulacion', anterior: periodo.fecha_inicio_postulacion, nuevo: ahora, motivo };
            periodo.fecha_inicio_postulacion = ahora;
          }
        } else if (!enPlazoPostulacion(periodo, new Date())) {
          throw new ConflictException(reopening
            ? 'La postulación solo puede reabrirse dentro de las fechas de postulación. Edita primero la fecha fin de postulación del período.'
            : 'El período solo puede abrirse dentro de las fechas de postulación.');
        }

        // Las postulaciones existentes se conservan al reabrir.
        return await this.respuesta(await this.aplicarApertura(manager, periodo, { actor, ip, automatico: false }, ajuste));
      });
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  async cerrarPostulacion(
    id: string,
    dto: TransicionPeriodoDto,
    actor: Usuario,
    ip: string | null,
  ): Promise<PeriodoResponseDto> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const periodo = await this.bloquear(manager, id);
        if (!periodo) throw new NotFoundException('No existe el período solicitado.');
        if (periodo.estado !== PeriodoEstado.POSTULACION_ABIERTA) {
          throw new ConflictException('Solo se pueden cerrar períodos con postulaciones abiertas.');
        }
        let ajuste: AjusteForzado | null = null;
        if (dto.forzar === true) {
          const motivo = motivoForzado(dto);
          const ahora = await ahoraBaseDatos(manager);
          if (!plazoPostulacionVencido(periodo, ahora)) {
            if (ahora.getTime() <= periodo.fecha_inicio_postulacion.getTime()) {
              throw new ConflictException('No se puede forzar el cierre: la fecha de inicio de postulación aún no llega.');
            }
            ajuste = { campo: 'fecha_fin_postulacion', anterior: periodo.fecha_fin_postulacion, nuevo: ahora, motivo };
            periodo.fecha_fin_postulacion = ahora;
          }
        } else if (!plazoPostulacionVencido(periodo, new Date())) {
          throw new ConflictException('El período solo puede cerrarse después de vencer el plazo de postulación.');
        }

        return await this.respuesta(await this.aplicarCierre(manager, periodo, { actor, ip, automatico: false }, ajuste));
      });
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  /**
   * Períodos que, según la hora indicada, deberían pasar automáticamente de BORRADOR a
   * POSTULACION_ABIERTA o de POSTULACION_ABIERTA a POSTULACION_CERRADA. Es solo una preselección:
   * cada transición vuelve a comprobar estado y fechas bajo bloqueo.
   */
  async candidatosTransicionAutomatica(now = new Date()): Promise<CandidatosTransicionAutomatica> {
    const [aperturas, cierres] = await Promise.all([
      this.repository.find({
        select: { id: true },
        where: {
          estado: PeriodoEstado.BORRADOR,
          fecha_inicio_postulacion: LessThanOrEqual(now),
          fecha_fin_postulacion: MoreThan(now),
        },
        order: { fecha_inicio_postulacion: 'ASC', id: 'ASC' },
      }),
      this.repository.find({
        select: { id: true },
        where: { estado: PeriodoEstado.POSTULACION_ABIERTA, fecha_fin_postulacion: LessThanOrEqual(now) },
        order: { fecha_fin_postulacion: 'ASC', id: 'ASC' },
      }),
    ]);
    return { aperturas: aperturas.map((periodo) => periodo.id), cierres: cierres.map((periodo) => periodo.id) };
  }

  /**
   * BORRADOR → POSTULACION_ABIERTA por fecha, sin actor. Idempotente: devuelve `false` sin
   * cambios si, bajo bloqueo, el período ya no está en BORRADOR o está fuera del plazo. Nunca
   * reabre POSTULACION_CERRADA; la reapertura sigue siendo manual.
   */
  async abrirPostulacionAutomatica(id: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const periodo = await this.bloquear(manager, id);
      if (!periodo || periodo.estado !== PeriodoEstado.BORRADOR || !enPlazoPostulacion(periodo, new Date())) return false;
      await this.aplicarApertura(manager, periodo, SISTEMA);
      return true;
    });
  }

  /**
   * POSTULACION_ABIERTA → POSTULACION_CERRADA al vencer el plazo, sin actor. Idempotente:
   * devuelve `false` sin cambios si, bajo bloqueo, ya no corresponde cerrar.
   */
  async cerrarPostulacionAutomatica(id: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const periodo = await this.bloquear(manager, id);
      if (!periodo || periodo.estado !== PeriodoEstado.POSTULACION_ABIERTA || !plazoPostulacionVencido(periodo, new Date())) return false;
      await this.aplicarCierre(manager, periodo, SISTEMA);
      return true;
    });
  }

  private bloquear(manager: EntityManager, id: string): Promise<PeriodoTitulacion | null> {
    return manager.getRepository(PeriodoTitulacion).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
  }

  /** Pasa a POSTULACION_ABIERTA y audita en la misma transacción; el llamador ya validó las reglas. */
  private async aplicarApertura(
    manager: EntityManager,
    periodo: PeriodoTitulacion,
    responsable: ResponsableTransicion,
    ajuste: AjusteForzado | null = null,
  ): Promise<PeriodoTitulacion> {
    const previous = periodo.estado;
    periodo.estado = PeriodoEstado.POSTULACION_ABIERTA;
    const updated = await manager.getRepository(PeriodoTitulacion).save(periodo);
    const accion = previous === PeriodoEstado.POSTULACION_CERRADA ? 'REABRIR_POSTULACION' : 'ABRIR_POSTULACION';
    await this.auditoria.registrar(manager, {
      actor: responsable.actor,
      accion: ajuste ? `${accion}_FORZADA` : accion,
      entidad_tipo: 'periodo_titulacion',
      entidad_id: periodo.id,
      valores_anteriores: { estado: previous, ...valoresAnterioresAjuste(ajuste) },
      valores_nuevos: { estado: PeriodoEstado.POSTULACION_ABIERTA, ...(responsable.automatico ? { automatico: true } : {}), ...valoresNuevosAjuste(ajuste) },
      ip_origen: responsable.ip,
    });
    return updated;
  }

  /** Pasa a POSTULACION_CERRADA y audita en la misma transacción; el llamador ya validó las reglas. */
  private async aplicarCierre(
    manager: EntityManager,
    periodo: PeriodoTitulacion,
    responsable: ResponsableTransicion,
    ajuste: AjusteForzado | null = null,
  ): Promise<PeriodoTitulacion> {
    periodo.estado = PeriodoEstado.POSTULACION_CERRADA;
    const updated = await manager.getRepository(PeriodoTitulacion).save(periodo);
    await this.auditoria.registrar(manager, {
      actor: responsable.actor,
      accion: ajuste ? 'CERRAR_POSTULACION_FORZADA' : 'CERRAR_POSTULACION',
      entidad_tipo: 'periodo_titulacion',
      entidad_id: periodo.id,
      valores_anteriores: { estado: PeriodoEstado.POSTULACION_ABIERTA, ...valoresAnterioresAjuste(ajuste) },
      valores_nuevos: { estado: PeriodoEstado.POSTULACION_CERRADA, ...(responsable.automatico ? { automatico: true } : {}), ...valoresNuevosAjuste(ajuste) },
      ip_origen: responsable.ip,
    });
    // Las reservas que no se confirmaron dentro del plazo vencen con el cierre (misma transacción).
    await this.reservas?.expirarPorCierre(manager, periodo.id, { actor: responsable.actor, ip: responsable.ip });
    return updated;
  }

  private handleDatabaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (isUniqueViolation(error)) {
      throw new ConflictException('Ya existe un período con ese código.');
    }
    throw new ServiceUnavailableException(
      'No se pudo completar la operación de períodos en PostgreSQL.',
    );
  }
}
