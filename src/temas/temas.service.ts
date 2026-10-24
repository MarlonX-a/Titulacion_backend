import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, LessThanOrEqual, MoreThanOrEqual, QueryFailedError, Repository } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { EstudianteHabilitado } from '../habilitados/entities/estudiante-habilitado.entity.js';
import { HabilitadoEstado } from '../habilitados/enums/habilitado-estado.enum.js';
import { SituacionIngreso } from '../habilitados/enums/situacion-ingreso.enum.js';
import { LineaInvestigacion } from '../lineas-investigacion/entities/linea-investigacion.entity.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CreateTemaDto } from './dto/create-tema.dto.js';
import { ListTemasQueryDto } from './dto/list-temas-query.dto.js';
import { TemaHistorialResponseDto } from './dto/tema-historial-response.dto.js';
import { TemaResponseDto } from './dto/tema-response.dto.js';
import { UpdateTemaDto } from './dto/update-tema.dto.js';
import type { PublicarTemaDto } from './dto/publicar-tema.dto.js';
import { TemaHistorial } from './entities/tema-historial.entity.js';
import { Tema } from './entities/tema.entity.js';
import { EstadoTema } from './enums/estado-tema.enum.js';

interface PostgresDriverError { code?: string; }
export interface PagedTemas { data: TemaResponseDto[]; total: number; page: number; limit: number; }
export interface PagedTemaHistorial { data: TemaHistorialResponseDto[]; total: number; page: number; limit: number; }

function hasCode(error: unknown, code: string): boolean {
  return error instanceof QueryFailedError && (error.driverError as PostgresDriverError).code === code;
}

function temaValues(tema: Tema): Record<string, unknown> {
  return {
    periodo_id: tema.periodo.id,
    linea_id: tema.linea.id,
    docente_proponente_id: tema.docente_proponente.id,
    titulo: tema.titulo,
    descripcion: tema.descripcion,
    min_integrantes: tema.min_integrantes,
    max_integrantes: tema.max_integrantes,
    estado: tema.estado,
    creado_en: tema.creado_en,
  };
}

function responseFrom(tema: Tema): TemaResponseDto {
  return {
    id: tema.id,
    periodo_id: tema.periodo.id,
    linea_id: tema.linea.id,
    linea: { id: tema.linea.id, codigo: tema.linea.codigo, nombre: tema.linea.nombre },
    docente_proponente_id: tema.docente_proponente.id,
    docente_proponente: {
      id: tema.docente_proponente.id,
      nombres: tema.docente_proponente.usuario.nombres,
      apellidos: tema.docente_proponente.usuario.apellidos,
    },
    titulo: tema.titulo,
    descripcion: tema.descripcion,
    min_integrantes: tema.min_integrantes,
    max_integrantes: tema.max_integrantes,
    estado: tema.estado,
    creado_en: tema.creado_en,
    disponible: tema.estado === EstadoTema.PUBLICADO,
    postulaciones_abiertas: 0,
  };
}

function historialResponseFrom(item: TemaHistorial): TemaHistorialResponseDto {
  return {
    id: item.id,
    tema_id: item.tema.id,
    usuario_id: item.usuario.id,
    responsable: { id: item.usuario.id, nombres: item.usuario.nombres, apellidos: item.usuario.apellidos },
    estado_anterior: item.estado_anterior,
    estado_nuevo: item.estado_nuevo,
    cambios: item.cambios,
    fecha: item.fecha,
  };
}

const temaRelations = { periodo: true, linea: true, docente_proponente: { usuario: true } } as const;

@Injectable()
export class TemasService {
  constructor(
    @InjectRepository(Tema) private readonly repository: Repository<Tema>,
    @InjectRepository(TemaHistorial) private readonly historialRepository: Repository<TemaHistorial>,
    @InjectRepository(Docente) private readonly docenteRepository: Repository<Docente>,
    @InjectRepository(Estudiante) private readonly estudianteRepository: Repository<Estudiante>,
    @InjectRepository(EstudianteHabilitado) private readonly habilitadoRepository: Repository<EstudianteHabilitado>,
    @InjectRepository(PeriodoTitulacion) private readonly periodoRepository: Repository<PeriodoTitulacion>,
    private readonly dataSource: DataSource,
    private readonly auditoria: AuditoriaService,
  ) {}

  async create(periodoId: string, dto: CreateTemaDto, actor: Usuario, ip: string | null): Promise<TemaResponseDto> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const periodo = await this.lockWritablePeriod(manager, periodoId);
        const refs = await this.references(manager, dto.linea_id, dto.docente_proponente_id);
        this.assertRange(dto.min_integrantes, dto.max_integrantes);
        const repo = manager.getRepository(Tema);
        const tema = await repo.save(repo.create({
          periodo, linea: refs.linea, docente_proponente: refs.docente,
          titulo: dto.titulo.trim(), descripcion: dto.descripcion.trim(),
          min_integrantes: dto.min_integrantes, max_integrantes: dto.max_integrantes,
          estado: EstadoTema.BORRADOR,
        }));
        const loaded = await this.loadForResponse(manager, tema.id, periodoId);
        await this.writeHistory(manager, loaded, actor, null);
        await this.auditoria.registrar(manager, {
          actor, accion: 'CREAR_TEMA', entidad_tipo: 'tema', entidad_id: loaded.id,
          valores_anteriores: null, valores_nuevos: temaValues(loaded), ip_origen: ip,
        });
        return responseFrom(loaded);
      });
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async list(periodoId: string, query: ListTemasQueryDto, actor: Usuario): Promise<PagedTemas> {
    try {
      const periodo = await this.periodoRepository.findOneBy({ id: periodoId });
      if (!periodo) throw new NotFoundException('No existe el período indicado.');
      if (actor.rol === UsuarioRol.ESTUDIANTE) {
        if (query.estado && query.estado !== EstadoTema.PUBLICADO) {
          throw new ForbiddenException('Los estudiantes solo pueden consultar temas publicados.');
        }
        await this.assertStudentCanViewCatalog(periodo, actor);
      }
      let docenteId = query.docente_proponente_id;
      if (actor.rol === UsuarioRol.DOCENTE) {
        const docente = await this.docenteRepository.findOne({ where: { usuario: { id: actor.id } } });
        if (!docente) throw new NotFoundException('La cuenta aún no tiene perfil de docente.');
        if (docenteId && docenteId !== docente.id) throw new ForbiddenException('Solo puedes consultar tus temas propuestos.');
        docenteId = docente.id;
      }
      const [records, total] = await this.repository.findAndCount({
        where: {
          periodo: { id: periodoId },
          ...(query.linea_id ? { linea: { id: query.linea_id } } : {}),
          ...(docenteId ? { docente_proponente: { id: docenteId } } : {}),
          ...(actor.rol === UsuarioRol.ESTUDIANTE
            ? { estado: EstadoTema.PUBLICADO }
            : query.estado ? { estado: query.estado } : {}),
          ...(query.num_integrantes !== undefined ? {
            min_integrantes: LessThanOrEqual(query.num_integrantes),
            max_integrantes: MoreThanOrEqual(query.num_integrantes),
          } : {}),
        },
        relations: temaRelations,
        order: { creado_en: 'DESC', id: 'ASC' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      return { data: await this.enrichAvailability(periodoId, records.map(responseFrom)), total, page: query.page, limit: query.limit };
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async getById(periodoId: string, id: string, actor: Usuario): Promise<TemaResponseDto> {
    try {
      const periodo = await this.periodoRepository.findOneBy({ id: periodoId });
      if (!periodo) throw new NotFoundException('No existe el período indicado.');
      if (actor.rol === UsuarioRol.ESTUDIANTE) await this.assertStudentCanViewCatalog(periodo, actor);
      const tema = await this.repository.findOne({ where: { id, periodo: { id: periodoId } }, relations: temaRelations });
      if (!tema) throw new NotFoundException('No existe el tema en el período indicado.');
      if (actor.rol === UsuarioRol.ESTUDIANTE && tema.estado !== EstadoTema.PUBLICADO) {
        throw new NotFoundException('No existe el tema en el período indicado.');
      }
      if (actor.rol === UsuarioRol.DOCENTE) {
        const docente = await this.docenteRepository.findOne({ where: { usuario: { id: actor.id } } });
        if (!docente) throw new NotFoundException('La cuenta aún no tiene perfil de docente.');
        if (tema.docente_proponente.id !== docente.id) throw new NotFoundException('No existe el tema en el período indicado.');
      }
      return (await this.enrichAvailability(periodoId, [responseFrom(tema)]))[0]!;
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async update(periodoId: string, id: string, dto: UpdateTemaDto, actor: Usuario, ip: string | null): Promise<TemaResponseDto> {
    if (!Object.values(dto).some((value) => value !== undefined)) throw new BadRequestException('Debe indicar al menos un campo para editar.');
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.lockWritablePeriod(manager, periodoId);
        const repo = manager.getRepository(Tema);
        const locked = await repo.findOne({ where: { id, periodo: { id: periodoId } }, lock: { mode: 'pessimistic_write' } });
        if (!locked) throw new NotFoundException('No existe el tema en el período indicado.');
        const tema = await repo.findOne({ where: { id: locked.id }, relations: temaRelations });
        if (!tema) throw new NotFoundException('No existe el tema en el período indicado.');
        if (tema.estado !== EstadoTema.BORRADOR) throw new ConflictException('Solo se pueden editar temas en estado BORRADOR.');
        const previous = temaValues(tema);
        const lineaId = dto.linea_id ?? tema.linea.id;
        const docenteId = dto.docente_proponente_id ?? tema.docente_proponente.id;
        const refs = await this.references(manager, lineaId, docenteId);
        tema.linea = refs.linea;
        tema.docente_proponente = refs.docente;
        if (dto.titulo !== undefined) tema.titulo = dto.titulo.trim();
        if (dto.descripcion !== undefined) tema.descripcion = dto.descripcion.trim();
        if (dto.min_integrantes !== undefined) tema.min_integrantes = dto.min_integrantes;
        if (dto.max_integrantes !== undefined) tema.max_integrantes = dto.max_integrantes;
        this.assertRange(tema.min_integrantes, tema.max_integrantes);
        const next = temaValues(tema);
        if (JSON.stringify(previous) === JSON.stringify(next)) return responseFrom(tema);
        await repo.save(tema);
        const loaded = await this.loadForResponse(manager, id, periodoId);
        await this.writeHistory(manager, loaded, actor, previous);
        await this.auditoria.registrar(manager, {
          actor, accion: 'ACTUALIZAR_TEMA', entidad_tipo: 'tema', entidad_id: id,
          valores_anteriores: previous, valores_nuevos: temaValues(loaded), ip_origen: ip,
        });
        return responseFrom(loaded);
      });
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async publish(
    periodoId: string,
    id: string,
    _dto: PublicarTemaDto,
    actor: Usuario,
    ip: string | null,
  ): Promise<TemaResponseDto> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.lockWritablePeriod(manager, periodoId);
        const repository = manager.getRepository(Tema);
        const locked = await repository.findOne({
          where: { id, periodo: { id: periodoId } },
          lock: { mode: 'pessimistic_write' },
        });
        if (!locked) throw new NotFoundException('No existe el tema en el período indicado.');
        const tema = await repository.findOne({ where: { id }, relations: temaRelations });
        if (!tema) throw new NotFoundException('No existe el tema en el período indicado.');
        if (tema.estado !== EstadoTema.BORRADOR) {
          throw new ConflictException('Solo se pueden publicar temas en estado BORRADOR.');
        }
        await this.references(manager, tema.linea.id, tema.docente_proponente.id);
        this.assertRange(tema.min_integrantes, tema.max_integrantes);
        if (!tema.titulo.trim() || !tema.descripcion.trim()) {
          throw new BadRequestException('El título y la descripción son obligatorios.');
        }
        const previous = temaValues(tema);
        tema.estado = EstadoTema.PUBLICADO;
        await repository.save(tema);
        const loaded = await this.loadForResponse(manager, id, periodoId);
        await this.writeHistory(manager, loaded, actor, previous);
        await this.auditoria.registrar(manager, {
          actor,
          accion: 'PUBLICAR_TEMA',
          entidad_tipo: 'tema',
          entidad_id: id,
          valores_anteriores: previous,
          valores_nuevos: temaValues(loaded),
          ip_origen: ip,
        });
        return responseFrom(loaded);
      });
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async history(periodoId: string, id: string, query: ListTemasQueryDto): Promise<PagedTemaHistorial> {
    try {
      const tema = await this.repository.findOneBy({ id, periodo: { id: periodoId } });
      if (!tema) throw new NotFoundException('No existe el tema en el período indicado.');
      const [records, total] = await this.historialRepository.findAndCount({
        where: { tema: { id } }, relations: { tema: true, usuario: true }, order: { fecha: 'ASC', id: 'ASC' },
        skip: (query.page - 1) * query.limit, take: query.limit,
      });
      return { data: records.map(historialResponseFrom), total, page: query.page, limit: query.limit };
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  private async lockWritablePeriod(manager: EntityManager, id: string): Promise<PeriodoTitulacion> {
    const period = await manager.getRepository(PeriodoTitulacion).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!period) throw new NotFoundException('No existe el período indicado.');
    if (period.estado === PeriodoEstado.BORRADOR) return period;
    if (period.estado !== PeriodoEstado.POSTULACION_ABIERTA) {
      throw new ConflictException('Los temas solo se administran en períodos BORRADOR o POSTULACION_ABIERTA.');
    }
    const now = new Date();
    if (now < period.fecha_inicio_postulacion || now >= period.fecha_fin_postulacion) {
      throw new ConflictException('Los temas solo se administran durante el plazo de postulación.');
    }
    return period;
  }

  private async references(manager: EntityManager, lineaId: string, docenteId: string): Promise<{ linea: LineaInvestigacion; docente: Docente }> {
    const linea = await manager.getRepository(LineaInvestigacion).findOne({ where: { id: lineaId }, lock: { mode: 'pessimistic_write' } });
    if (!linea) throw new NotFoundException('No existe la línea de investigación indicada.');
    if (!linea.activa) throw new ConflictException('La línea de investigación está inactiva.');
    const docenteLocked = await manager.getRepository(Docente).findOne({ where: { id: docenteId }, lock: { mode: 'pessimistic_write' } });
    if (!docenteLocked) throw new NotFoundException('No existe el docente proponente indicado.');
    const docente = await manager.getRepository(Docente).findOne({ where: { id: docenteId }, relations: { usuario: true } });
    if (!docente) throw new NotFoundException('No existe el docente proponente indicado.');
    if (docente.usuario.estado !== UsuarioEstado.ACTIVO || docente.usuario.rol !== UsuarioRol.DOCENTE) throw new ConflictException('El docente proponente debe tener una cuenta activa con rol DOCENTE.');
    const lockedAccount = await manager.getRepository(Usuario).findOne({ where: { id: docente.usuario.id }, lock: { mode: 'pessimistic_write' } });
    if (!lockedAccount || lockedAccount.estado !== UsuarioEstado.ACTIVO || lockedAccount.rol !== UsuarioRol.DOCENTE) {
      throw new ConflictException('El docente proponente debe tener una cuenta activa con rol DOCENTE.');
    }
    return { linea, docente };
  }

  private async assertStudentCanViewCatalog(periodo: PeriodoTitulacion, actor: Usuario): Promise<void> {
    if (periodo.estado !== PeriodoEstado.POSTULACION_ABIERTA) {
      throw new ForbiddenException('El catálogo estudiantil está disponible cuando el período está abierto.');
    }
    const estudiante = await this.estudianteRepository.findOne({ where: { usuario: { id: actor.id } } });
    if (!estudiante) throw new ForbiddenException('La cuenta no tiene un perfil de estudiante.');
    const habilitacion = await this.habilitadoRepository.findOne({
      where: {
        periodo: { id: periodo.id },
        estudiante: { usuario: { id: actor.id } },
        estado: HabilitadoEstado.HABILITADO,
      },
      relations: { estudiante: true },
    });
    if (!habilitacion || ![SituacionIngreso.PENDIENTE, SituacionIngreso.ADMITIDO].includes(habilitacion.situacion_ingreso)) {
      throw new ForbiddenException('No tienes una habilitación vigente para consultar este catálogo.');
    }
  }

  private async loadForResponse(manager: EntityManager, id: string, periodoId: string): Promise<Tema> {
    const record = await manager.getRepository(Tema).findOne({ where: { id, periodo: { id: periodoId } }, relations: temaRelations });
    if (!record) throw new NotFoundException('No existe el tema en el período indicado.');
    return record;
  }

  private async enrichAvailability(periodoId: string, responses: TemaResponseDto[]): Promise<TemaResponseDto[]> {
    if (responses.length === 0) return responses;
    const ids = responses.map((item) => item.id);
    const configuredSchema = (this.dataSource.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(configuredSchema)) throw new ServiceUnavailableException('El esquema PostgreSQL configurado no es válido.');
    const schema = `"${configuredSchema}"`;
    const stats = await this.dataSource.query(
      `SELECT t."id",(t."estado"='PUBLICADO' AND NOT EXISTS (SELECT 1 FROM ${schema}."asignacion_tema" a WHERE a."tema_id"=t."id" AND a."estado"='VIGENTE')) AS disponible,(SELECT count(*)::int FROM ${schema}."postulacion" p WHERE p."tema_id"=t."id" AND p."periodo_id"=$1 AND p."estado" IN ('PENDIENTE','EN_CONFLICTO')) AS postulaciones_abiertas FROM ${schema}."tema" t WHERE t."periodo_id"=$1 AND t."id"=ANY($2::uuid[])`,
      [periodoId, ids],
    ) as Array<{ id: string; disponible: boolean; postulaciones_abiertas: number }>;
    const byId = new Map(stats.map((row) => [row.id, row]));
    return responses.map((item) => ({ ...item, disponible: byId.get(item.id)?.disponible ?? false, postulaciones_abiertas: Number(byId.get(item.id)?.postulaciones_abiertas ?? 0) }));
  }

  private async writeHistory(manager: EntityManager, tema: Tema, actor: Usuario, previous: Record<string, unknown> | null): Promise<void> {
    const repository = manager.getRepository(TemaHistorial);
    await repository.save(repository.create({
      tema, usuario: actor, estado_anterior: previous ? previous.estado as EstadoTema : null, estado_nuevo: tema.estado,
      cambios: { anteriores: previous, nuevos: temaValues(tema) }, fecha: new Date(),
    }));
  }

  private assertRange(min: number, max: number): void {
    if (max < min) throw new BadRequestException('El máximo de integrantes debe ser igual o mayor que el mínimo.');
  }

  private handleDatabaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (hasCode(error, '23503')) throw new ConflictException('Una referencia relacionada no es compatible con el tema.');
    if (hasCode(error, '23514')) throw new BadRequestException('Los datos incumplen una regla de tema.');
    throw new ServiceUnavailableException('No se pudo completar la operación de temas en PostgreSQL.', { cause: error });
  }
}
