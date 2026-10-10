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
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { EstudiantesService } from '../estudiantes/estudiantes.service.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { CreateHabilitacionDto } from './dto/create-habilitacion.dto.js';
import { HabilitadoResponseDto } from './dto/habilitado-response.dto.js';
import { ListHabilitadosQueryDto } from './dto/list-habilitados-query.dto.js';
import { ResolveIngresoDto } from './dto/resolve-ingreso.dto.js';
import { EstudianteHabilitado } from './entities/estudiante-habilitado.entity.js';
import { CondicionIngreso } from './enums/condicion-ingreso.enum.js';
import { HabilitadoEstado } from './enums/habilitado-estado.enum.js';
import { HabilitadoOrigen } from './enums/habilitado-origen.enum.js';
import { SituacionIngreso } from './enums/situacion-ingreso.enum.js';
import { AsignacionTemaPersistenciaService } from '../asignaciones-tema/asignacion-tema-persistencia.service.js';
import { NotificacionesPersistenciaService } from '../notificaciones/notificaciones-persistencia.service.js';

interface PostgresDriverError { code?: string; }

export interface PagedHabilitados {
  data: HabilitadoResponseDto[];
  total: number;
  page: number;
  limit: number;
}

function responseFrom(record: EstudianteHabilitado): HabilitadoResponseDto {
  return {
    id: record.id,
    periodo_id: record.periodo.id,
    estudiante_id: record.estudiante.id,
    estudiante: {
      id: record.estudiante.id,
      nombres: record.estudiante.usuario.nombres,
      apellidos: record.estudiante.usuario.apellidos,
      matricula: record.estudiante.matricula,
    },
    origen: record.origen,
    lote_importacion_id: record.lote_importacion?.id ?? null,
    estado: record.estado,
    condicion_ingreso: record.condicion_ingreso,
    requisito_pendiente: record.requisito_pendiente,
    situacion_ingreso: record.situacion_ingreso,
    fecha_habilitacion: record.fecha_habilitacion,
    fecha_resolucion_ingreso: record.fecha_resolucion_ingreso,
    resuelto_por_id: record.resuelto_por?.id ?? null,
    observacion_ingreso: record.observacion_ingreso,
  };
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof QueryFailedError &&
    (error.driverError as PostgresDriverError).code === code;
}

@Injectable()
export class HabilitadosService {
  constructor(
    @InjectRepository(EstudianteHabilitado)
    private readonly repository: Repository<EstudianteHabilitado>,
    private readonly dataSource: DataSource,
    private readonly estudiantes: EstudiantesService,
    private readonly auditoria: AuditoriaService,
    private readonly asignaciones: AsignacionTemaPersistenciaService,
    private readonly notificaciones: NotificacionesPersistenciaService,
  ) {}

  /** Comprueba y bloquea una habilitación para una operación de grupo dentro de la transacción actual. */
  async getEligibleStudentForGroup(
    periodoId: string,
    estudianteId: string,
    manager: EntityManager,
  ): Promise<Estudiante> {
    let student: Estudiante;
    try {
      student = await this.estudiantes.getActiveProfileForHabilitacion(estudianteId, manager);
    } catch (error: unknown) {
      if (error instanceof ConflictException) throw new ForbiddenException('La cuenta del estudiante no está activa o ya no tiene el rol requerido.');
      throw error;
    }
    const locked = await manager.getRepository(EstudianteHabilitado)
      .createQueryBuilder('habilitado')
      .select(['habilitado.id'])
      .where('habilitado.periodo_id = :periodoId', { periodoId })
      .andWhere('habilitado.estudiante_id = :estudianteId', { estudianteId })
      .setLock('pessimistic_write')
      .getOne();
    if (!locked) throw new ForbiddenException('El estudiante no está habilitado en este período.');
    const record = await manager.getRepository(EstudianteHabilitado).findOne({ where: { id: locked.id } });
    if (!record || record.estado !== HabilitadoEstado.HABILITADO ||
      ![SituacionIngreso.PENDIENTE, SituacionIngreso.ADMITIDO].includes(record.situacion_ingreso)) {
      throw new ForbiddenException('La situación del estudiante no permite incorporarlo a un grupo.');
    }
    return student;
  }

  async create(
    periodoId: string,
    actor: Usuario,
    dto: CreateHabilitacionDto,
    ip: string | null,
  ): Promise<HabilitadoResponseDto> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const periodo = await this.lockDraftPeriod(manager, periodoId);
        const estudiante = await this.estudiantes.getActiveProfileForHabilitacion(
          dto.estudiante_id,
          manager,
        );
        const now = new Date();
        const isRegular = dto.condicion_ingreso === CondicionIngreso.REGULAR;
        if (isRegular && dto.requisito_pendiente != null) {
          throw new BadRequestException('Una habilitación REGULAR no admite requisito pendiente.');
        }
        const recordRepository = manager.getRepository(EstudianteHabilitado);
        const record = await recordRepository.save(recordRepository.create({
          periodo,
          estudiante,
          origen: HabilitadoOrigen.MANUAL,
          lote_importacion: null,
          estado: HabilitadoEstado.HABILITADO,
          condicion_ingreso: dto.condicion_ingreso,
          requisito_pendiente: isRegular ? null : dto.requisito_pendiente!.trim(),
          situacion_ingreso: isRegular ? SituacionIngreso.ADMITIDO : SituacionIngreso.PENDIENTE,
          fecha_habilitacion: now,
          fecha_resolucion_ingreso: isRegular ? now : null,
          resuelto_por: isRegular ? actor : null,
          observacion_ingreso: null,
        }));
        await this.auditoria.registrar(manager, { actor, accion: 'CREAR_HABILITACION', entidad_tipo: 'estudiante_habilitado', entidad_id: record.id, valores_anteriores: null, valores_nuevos: {
          periodo_id: periodo.id,
          estudiante_id: estudiante.id,
          condicion_ingreso: record.condicion_ingreso,
          situacion_ingreso: record.situacion_ingreso,
          origen: record.origen,
          estado: record.estado,
          requisito_pendiente: record.requisito_pendiente,
        }, ip_origen: ip });
        return responseFrom(record);
      });
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  async list(periodoId: string, query: ListHabilitadosQueryDto): Promise<PagedHabilitados> {
    try {
      const [records, total] = await this.repository.findAndCount({
        where: {
          periodo: { id: periodoId },
          ...(query.condicion_ingreso ? { condicion_ingreso: query.condicion_ingreso } : {}),
          ...(query.situacion_ingreso ? { situacion_ingreso: query.situacion_ingreso } : {}),
          ...(query.estado ? { estado: query.estado } : {}),
        },
        relations: { periodo: true, estudiante: { usuario: true }, lote_importacion: true, resuelto_por: true },
        order: { fecha_habilitacion: 'DESC', id: 'ASC' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      return { data: records.map(responseFrom), total, page: query.page, limit: query.limit };
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  async getById(periodoId: string, id: string): Promise<HabilitadoResponseDto> {
    try {
      const record = await this.repository.findOne({
        where: { id, periodo: { id: periodoId } },
        relations: { periodo: true, estudiante: { usuario: true }, lote_importacion: true, resuelto_por: true },
      });
      if (!record) throw new NotFoundException('No existe esa habilitación en el período indicado.');
      return responseFrom(record);
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  async getMine(periodoId: string, usuario: Usuario): Promise<HabilitadoResponseDto> {
    try {
      const record = await this.repository.findOne({
        where: { periodo: { id: periodoId }, estudiante: { usuario: { id: usuario.id } } },
        relations: { periodo: true, estudiante: { usuario: true }, lote_importacion: true, resuelto_por: true },
      });
      if (!record) throw new NotFoundException('No tienes una habilitación en el período indicado.');
      return responseFrom(record);
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  async resolve(
    periodoId: string,
    id: string,
    actor: Usuario,
    dto: ResolveIngresoDto,
    ip: string | null,
  ): Promise<HabilitadoResponseDto> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const period = await manager.getRepository(PeriodoTitulacion).findOne({
          where: { id: periodoId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!period) throw new NotFoundException('No existe el período indicado.');
        if (period.estado !== PeriodoEstado.BORRADOR && period.estado !== PeriodoEstado.POSTULACION_ABIERTA && period.estado !== PeriodoEstado.POSTULACION_CERRADA) {
          throw new ConflictException('Solo se pueden resolver condicionados antes de iniciar la titulación.');
        }
        const now = new Date();
        const lateNoAdmission = dto.situacion_ingreso === SituacionIngreso.NO_ADMITIDO && period.estado === PeriodoEstado.POSTULACION_CERRADA;
        if (now >= period.fecha_inicio_titulacion && !lateNoAdmission) throw new ConflictException('ADMITIDO debe registrarse antes del inicio de titulación; NO_ADMITIDO tardío requiere período cerrado.');
        const repository = manager.getRepository(EstudianteHabilitado);
        const locked = await repository.findOne({
          where: { id, periodo: { id: periodoId } },
          lock: { mode: 'pessimistic_write' },
        });
        if (!locked) throw new NotFoundException('No existe esa habilitación en el período indicado.');
        const record = await repository.findOne({
          where: { id: locked.id },
          relations: { periodo: true, estudiante: { usuario: true }, lote_importacion: true, resuelto_por: true },
        });
        if (!record) throw new NotFoundException('No existe esa habilitación en el período indicado.');
        if (record.condicion_ingreso !== CondicionIngreso.CONDICIONADO || record.situacion_ingreso !== SituacionIngreso.PENDIENTE) {
          throw new ConflictException('Solo se pueden resolver ingresos condicionados pendientes.');
        }
        const previous = {
          situacion_ingreso: record.situacion_ingreso,
          fecha_resolucion_ingreso: record.fecha_resolucion_ingreso,
          resuelto_por_id: record.resuelto_por?.id ?? null,
          observacion_ingreso: record.observacion_ingreso,
        };
        record.situacion_ingreso = dto.situacion_ingreso;
        record.fecha_resolucion_ingreso = new Date();
        record.resuelto_por = actor;
        record.observacion_ingreso = dto.observacion_ingreso?.trim() || null;
        const updated = await repository.save(record);
        if (updated.situacion_ingreso === SituacionIngreso.NO_ADMITIDO) {
          await this.asignaciones.anularPorIncumplimiento(manager, periodoId, updated.estudiante.id, actor, updated.observacion_ingreso!, ip);
        }
        await this.auditoria.registrar(manager, { actor, accion: 'RESOLVER_INGRESO', entidad_tipo: 'estudiante_habilitado', entidad_id: record.id, valores_anteriores: previous, valores_nuevos: {
          situacion_ingreso: updated.situacion_ingreso,
          fecha_resolucion_ingreso: updated.fecha_resolucion_ingreso,
          resuelto_por_id: actor.id,
          observacion_ingreso: updated.observacion_ingreso,
        }, ip_origen: ip });
        await this.notificaciones.ingreso(manager, record.id, actor.id);
        return responseFrom(updated);
      });
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  private async lockDraftPeriod(manager: EntityManager, id: string): Promise<PeriodoTitulacion> {
    const period = await manager.getRepository(PeriodoTitulacion).findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!period) throw new NotFoundException('No existe el período indicado.');
    if (period.estado !== PeriodoEstado.BORRADOR) {
      throw new ConflictException('Las habilitaciones solo se administran en períodos BORRADOR.');
    }
    return period;
  }

  private handleDatabaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (isCode(error, '23505')) throw new ConflictException('El estudiante ya está habilitado en este período.');
    if (isCode(error, '23503')) throw new ConflictException('Una cuenta o registro relacionado no es compatible.');
    if (isCode(error, '23514')) throw new BadRequestException('Los datos incumplen una regla de habilitación.');
    throw new ServiceUnavailableException(
      'No se pudo completar la operación de habilitados en PostgreSQL.',
      { cause: error },
    );
  }
}
