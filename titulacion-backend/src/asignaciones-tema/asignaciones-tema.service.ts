import { ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { EstudianteHabilitado } from '../habilitados/entities/estudiante-habilitado.entity.js';
import { HabilitadosService } from '../habilitados/habilitados.service.js';
import { SituacionIngreso } from '../habilitados/enums/situacion-ingreso.enum.js';
import { Grupo } from '../grupos/entities/grupo.entity.js';
import { GrupoIntegrante } from '../grupos/entities/grupo-integrante.entity.js';
import { GrupoEstado } from '../grupos/enums/grupo-estado.enum.js';
import { GrupoIntegranteEstado } from '../grupos/enums/grupo-integrante-estado.enum.js';
import { GrupoIntegranteRol } from '../grupos/enums/grupo-integrante-rol.enum.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { Postulacion } from '../postulaciones/entities/postulacion.entity.js';
import { EstadoPostulacion } from '../postulaciones/enums/estado-postulacion.enum.js';
import { ModalidadPostulacion } from '../postulaciones/enums/modalidad-postulacion.enum.js';
import { ResolucionConflicto } from '../conflictos/entities/resolucion-conflicto.entity.js';
import { ConflictoParticipante } from '../conflictos/entities/conflicto-participante.entity.js';
import { Tema } from '../temas/entities/tema.entity.js';
import { TemaHistorial } from '../temas/entities/tema-historial.entity.js';
import { EstadoTema } from '../temas/enums/estado-tema.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { AsignacionTema } from './entities/asignacion-tema.entity.js';
import { AsignacionTemaPersistenciaService } from './asignacion-tema-persistencia.service.js';
import { AsignacionTemaEstado } from './enums/asignacion-tema-estado.enum.js';
import { AsignarTemaDto } from './dto/asignar-tema.dto.js';
import { ListAsignacionesTemaQueryDto } from './dto/list-asignaciones-tema-query.dto.js';
import { AsignacionTemaResponseDto, PagedAsignacionesTemaResponseDto } from './dto/asignacion-tema-response.dto.js';
import { NotificacionesPersistenciaService } from '../notificaciones/notificaciones-persistencia.service.js';
import { NotificacionTipo } from '../notificaciones/enums/notificacion-canal.enum.js';

interface PgError { code?: string; }
const relations = {
  tema: { periodo: true, linea: true, docente_proponente: { usuario: true } },
  postulacion: true, grupo: true, estudiante: { usuario: true }, aprobada_por: true, anulada_por: true,
} as const;

@Injectable()
export class AsignacionesTemaService {
  constructor(
    @InjectRepository(AsignacionTema) private readonly repository: Repository<AsignacionTema>,
    @InjectRepository(Estudiante) private readonly students: Repository<Estudiante>,
    private readonly dataSource: DataSource,
    private readonly habilitados: HabilitadosService,
    private readonly auditoria: AuditoriaService,
    private readonly persistencia: AsignacionTemaPersistenciaService,
    private readonly notificaciones: NotificacionesPersistenciaService,
  ) {}

  async assign(periodoId: string, postulacionId: string, dto: AsignarTemaDto, actor: Usuario, ip: string | null): Promise<AsignacionTemaResponseDto> {
    try {
      const id = await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
        const period = await manager.getRepository(PeriodoTitulacion).findOne({ where: { id: periodoId }, lock: { mode: 'pessimistic_write' } });
        if (!period) throw new NotFoundException('No existe el período indicado.');
        if (period.estado !== PeriodoEstado.POSTULACION_CERRADA) throw new ConflictException('Solo se asignan temas con el período en POSTULACION_CERRADA.');
        const found = await manager.getRepository(Postulacion).findOne({ where: { id: postulacionId, periodo: { id: periodoId } }, relations: { tema: true, grupo: true, estudiante: true, periodo: true } });
        if (!found) throw new NotFoundException('No existe esa postulación en el período indicado.');
        const topicRepo = manager.getRepository(Tema);
        const topicLock = await topicRepo.findOne({ where: { id: found.tema.id, periodo: { id: periodoId } }, lock: { mode: 'pessimistic_write' } });
        if (!topicLock) throw new NotFoundException('No existe el tema de esa postulación.');
        const topic = await topicRepo.findOne({ where: { id: topicLock.id }, relations: { periodo: true, linea: true, docente_proponente: { usuario: true } } });
        if (!topic) throw new NotFoundException('No existe el tema de esa postulación.');
        if (topic.estado !== EstadoTema.PUBLICADO) throw new ConflictException('Solo se asignan postulaciones a temas PUBLICADOS.');
        const initial = found.grupo ? await manager.getRepository(Grupo).findOne({ where: { id: found.grupo.id, periodo: { id: periodoId } }, lock: { mode: 'pessimistic_write' } }) : null;
        if (found.grupo && !initial) throw new NotFoundException('No existe el grupo de la postulación.');
        const schema = this.schema(manager);
        const locked = await manager.query(`SELECT "id" FROM ${schema}."postulacion" WHERE "id"=$1 AND "periodo_id"=$2 FOR UPDATE`, [postulacionId, periodoId]) as Array<{ id: string }>;
        if (!locked.length) throw new NotFoundException('No existe esa postulación en el período indicado.');
        const app = await manager.getRepository(Postulacion).findOne({ where: { id: postulacionId }, relations: { grupo: true, estudiante: true, tema: true, periodo: true } });
        if (!app) throw new NotFoundException('No existe esa postulación en el período indicado.');
        if (app.estado !== EstadoPostulacion.PENDIENTE) throw new ConflictException('Solo se pueden asignar postulaciones PENDIENTE.');
        if (await manager.getRepository(AsignacionTema).exist({ where: { tema_id: topic.id, estado: AsignacionTemaEstado.VIGENTE } })) throw new ConflictException('El tema ya tiene una asignación vigente.');

        const participantIds = await this.validateApplication(manager, app, topic, period.fecha_inicio_titulacion);
        for (const studentId of participantIds) {
          if (await this.persistencia.tieneVigenteParaEstudiante(manager, studentId)) throw new ConflictException('Uno o más participantes ya tienen otra asignación vigente.');
        }
        if (app.grupo && await this.persistencia.tieneVigenteParaGrupo(manager, app.grupo.id)) throw new ConflictException('El grupo ya tiene una asignación vigente.');

        const allCandidateIds = await manager.query(`SELECT "id" FROM ${schema}."postulacion" WHERE "periodo_id"=$1 AND "tema_id"=$2 AND "estado" IN ('PENDIENTE','EN_CONFLICTO') ORDER BY "id" FOR UPDATE`, [periodoId, topic.id]) as Array<{ id: string }>;
        const eligibleIds: string[] = [];
        for (const candidate of allCandidateIds) {
          const candidateApp = await manager.getRepository(Postulacion).findOne({ where: { id: candidate.id }, relations: { grupo: true, estudiante: true, periodo: true } });
          if (candidateApp && await this.isCandidateEligible(manager, candidateApp, topic, period.fecha_inicio_titulacion)) eligibleIds.push(candidate.id);
        }
        const resolution = await manager.getRepository(ResolucionConflicto).findOne({ where: { tema: { id: topic.id }, periodo: { id: periodoId } } });
        if (!resolution) {
          if (eligibleIds.length !== 1 || eligibleIds[0] !== app.id) throw new ConflictException(eligibleIds.length > 1 ? 'El tema tiene varias candidaturas elegibles; registra primero la resolución del conflicto.' : 'La postulación ya no es la única candidatura elegible del tema.');
        } else {
          if (resolution.postulacion_ganadora_id !== app.id) throw new ConflictException('Solo puede asignarse la postulación ganadora de la resolución registrada.');
          const participants = await manager.getRepository(ConflictoParticipante).find({ where: { resolucion_conflicto_id: resolution.id } });
          const resolvedIds = new Set(participants.map((row) => row.postulacion_id));
          if (!resolvedIds.has(app.id) || eligibleIds.some((candidateId) => !resolvedIds.has(candidateId))) throw new ConflictException('La resolución ya no cubre las candidaturas elegibles actuales; requiere revisión administrativa.');
        }

        const beforeTopic = this.topicValues(topic);
        const now = new Date();
        app.estado = EstadoPostulacion.ACEPTADA;
        app.observacion = `Asignación aprobada: ${dto.motivo.trim()}`;
        await manager.getRepository(Postulacion).save(app);
        const assignmentRepo = manager.getRepository(AsignacionTema);
        const assignment = await assignmentRepo.save(assignmentRepo.create({
          tema_id: topic.id, tema: topic, periodo_id: periodoId, postulacion_id: app.id, postulacion: app,
          grupo_id: app.grupo?.id ?? null, grupo: app.grupo ?? null,
          estudiante_id: app.estudiante?.id ?? null, estudiante: app.estudiante ?? null,
          aprobada_por_id: actor.id, aprobada_por: actor, estado: AsignacionTemaEstado.VIGENTE,
          fecha_asignacion: now, motivo: dto.motivo.trim(), causa_anulacion: null, motivo_anulacion: null,
          anulada_por_id: null, anulada_por: null, fecha_anulacion: null,
        }));
        topic.estado = EstadoTema.ASIGNADO;
        await topicRepo.save(topic);
        const nextTopic = this.topicValues(topic);
        await manager.getRepository(TemaHistorial).save(manager.getRepository(TemaHistorial).create({ tema: topic, usuario: actor, estado_anterior: EstadoTema.PUBLICADO, estado_nuevo: EstadoTema.ASIGNADO, cambios: { anteriores: beforeTopic, nuevos: nextTopic }, fecha: now }));
        await this.auditoria.registrar(manager, { actor, accion: 'ACEPTAR_POSTULACION', entidad_tipo: 'postulacion', entidad_id: app.id, valores_anteriores: { estado: EstadoPostulacion.PENDIENTE, observacion: null }, valores_nuevos: { estado: app.estado, observacion: app.observacion }, ip_origen: ip });
        await this.auditoria.registrar(manager, { actor, accion: 'ASIGNAR_TEMA', entidad_tipo: 'asignacion_tema', entidad_id: assignment.id, valores_anteriores: null, valores_nuevos: { periodo_id: periodoId, tema_id: topic.id, postulacion_id: app.id, grupo_id: app.grupo?.id ?? null, estudiante_id: app.estudiante?.id ?? null, participantes: participantIds, aprobada_por_id: actor.id, estado: assignment.estado, fecha_asignacion: now, motivo: assignment.motivo }, ip_origen: ip });
        await this.auditoria.registrar(manager, { actor, accion: 'ASIGNAR_TEMA', entidad_tipo: 'tema', entidad_id: topic.id, valores_anteriores: beforeTopic, valores_nuevos: nextTopic, ip_origen: ip });
        await this.notificaciones.asignacionTema(manager, assignment.id, NotificacionTipo.TEMA_ASIGNADO, actor.id);
        const losers = await manager.getRepository(Postulacion).find({ where: { tema: { id: topic.id }, periodo: { id: periodoId } } });
        for (const loser of losers) {
          if (loser.id === app.id || ![EstadoPostulacion.PENDIENTE, EstadoPostulacion.EN_CONFLICTO].includes(loser.estado)) continue;
          const previous = { estado: loser.estado, observacion: loser.observacion };
          loser.estado = EstadoPostulacion.RECHAZADA;
          loser.observacion = `Otra postulación fue asignada: ${dto.motivo.trim()}`;
          await manager.getRepository(Postulacion).save(loser);
          await this.auditoria.registrar(manager, { actor, accion: 'RECHAZAR_POSTULACION_POR_ASIGNACION', entidad_tipo: 'postulacion', entidad_id: loser.id, valores_anteriores: previous, valores_nuevos: { estado: loser.estado, observacion: loser.observacion }, ip_origen: ip });
          await this.notificaciones.postulacion(manager, loser.id, NotificacionTipo.POSTULACION_RECHAZADA, actor.id);
        }
        return assignment.id;
      });
      return this.getById(periodoId, id, actor, true);
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async list(periodoId: string, query: ListAsignacionesTemaQueryDto, actor: Usuario, isAdmin: boolean): Promise<PagedAsignacionesTemaResponseDto> {
    try {
      if (!await this.dataSource.getRepository(PeriodoTitulacion).exist({ where: { id: periodoId } })) throw new NotFoundException('No existe el período indicado.');
      const qb = this.repository.createQueryBuilder('a').leftJoinAndSelect('a.tema', 't').leftJoinAndSelect('t.docente_proponente', 'docente').leftJoinAndSelect('docente.usuario', 'docenteUser').leftJoinAndSelect('a.grupo', 'g').leftJoinAndSelect('a.estudiante', 'student').leftJoinAndSelect('student.usuario', 'studentUser').leftJoinAndSelect('a.postulacion', 'p').leftJoinAndSelect('a.aprobada_por', 'approved').leftJoinAndSelect('a.anulada_por', 'cancelled').where('a.periodo_id=:periodoId', { periodoId });
      if (query.estado) qb.andWhere('a.estado=:estado', { estado: query.estado });
      if (query.tema_id) qb.andWhere('a.tema_id=:temaId', { temaId: query.tema_id });
      if (query.modalidad === 'INDIVIDUAL') qb.andWhere('a.estudiante_id IS NOT NULL');
      if (query.modalidad === 'GRUPAL') qb.andWhere('a.grupo_id IS NOT NULL');
      if (!isAdmin) qb.andWhere('docenteUser.id=:actorId', { actorId: actor.id });
      const [items, total] = await qb.orderBy('a.fecha_asignacion', 'DESC').addOrderBy('a.id', 'ASC').skip((query.page - 1) * query.limit).take(query.limit).getManyAndCount();
      return { data: await Promise.all(items.map((item) => this.toResponse(item))), total, page: query.page, limit: query.limit };
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async listMine(periodoId: string, actor: Usuario, query: ListAsignacionesTemaQueryDto): Promise<PagedAsignacionesTemaResponseDto> {
    try {
      if (!await this.dataSource.getRepository(PeriodoTitulacion).exist({ where: { id: periodoId } })) throw new NotFoundException('No existe el período indicado.');
      const student = await this.students.findOne({ where: { usuario: { id: actor.id } } });
      if (!student) throw new NotFoundException('No tienes perfil de estudiante.');
      const schema = this.schema(this.dataSource.manager);
      const qb = this.repository.createQueryBuilder('a').leftJoinAndSelect('a.tema', 't').leftJoinAndSelect('t.docente_proponente', 'docente').leftJoinAndSelect('docente.usuario', 'docenteUser').leftJoinAndSelect('a.grupo', 'g').leftJoinAndSelect('a.estudiante', 'owner').leftJoinAndSelect('owner.usuario', 'ownerUser').leftJoinAndSelect('a.postulacion', 'p').leftJoinAndSelect('a.aprobada_por', 'approved').leftJoinAndSelect('a.anulada_por', 'cancelled').where('a.periodo_id=:periodoId', { periodoId }).andWhere(`(a.estudiante_id=:studentId OR EXISTS (SELECT 1 FROM ${schema}."grupo_integrante" gi WHERE gi."grupo_id"=a.grupo_id AND gi."estudiante_id"=:studentId))`, { studentId: student.id });
      if (query.estado) qb.andWhere('a.estado=:estado', { estado: query.estado });
      if (query.tema_id) qb.andWhere('a.tema_id=:temaId', { temaId: query.tema_id });
      if (query.modalidad === 'INDIVIDUAL') qb.andWhere('a.estudiante_id IS NOT NULL');
      if (query.modalidad === 'GRUPAL') qb.andWhere('a.grupo_id IS NOT NULL');
      const [items, total] = await qb.orderBy('a.fecha_asignacion', 'DESC').addOrderBy('a.id', 'ASC').skip((query.page - 1) * query.limit).take(query.limit).getManyAndCount();
      return { data: await Promise.all(items.map((item) => this.toResponse(item))), total, page: query.page, limit: query.limit };
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async getById(periodoId: string, id: string, actor: Usuario, isAdmin: boolean): Promise<AsignacionTemaResponseDto> {
    try {
      const item = await this.repository.findOne({ where: { id, periodo_id: periodoId }, relations });
      if (!item) throw new NotFoundException('No existe esa asignación en el período indicado.');
      if (!isAdmin) {
        if (actor.rol === UsuarioRol.DOCENTE && item.tema.docente_proponente.usuario.id !== actor.id) throw new NotFoundException('No existe esa asignación visible para el usuario.');
        if (actor.rol === UsuarioRol.ESTUDIANTE) {
          const student = await this.students.findOne({ where: { usuario: { id: actor.id } } });
          if (!student || !(item.estudiante_id === student.id || (item.grupo_id && await this.dataSource.getRepository(GrupoIntegrante).exist({ where: { grupo: { id: item.grupo_id }, estudiante: { id: student.id } } })))) throw new NotFoundException('No existe esa asignación visible para el usuario.');
        }
      }
      return this.toResponse(item);
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  private async validateApplication(manager: EntityManager, app: Postulacion, topic: Tema, start: Date): Promise<string[]> {
    if (app.grupo) {
      const group = await manager.getRepository(Grupo).findOne({ where: { id: app.grupo.id }, lock: { mode: 'pessimistic_write' } });
      if (!group || group.estado !== GrupoEstado.ACTIVO) throw new ConflictException('La asignación grupal requiere un grupo ACTIVO.');
      const members = await manager.getRepository(GrupoIntegrante).find({ where: { grupo: { id: group.id }, estado: GrupoIntegranteEstado.ACTIVO }, relations: { estudiante: true }, order: { estudiante: { id: 'ASC' } } });
      if (members.length < 2 || members.length !== app.num_integrantes || members.filter((member) => member.rol_en_grupo === GrupoIntegranteRol.REPRESENTANTE).length !== 1) throw new ConflictException('La composición o representación del grupo cambió desde su postulación.');
      const ids = members.map((member) => member.estudiante.id).sort();
      await this.validateParticipants(manager, app.periodo.id, ids, start);
      if (ids.length < topic.min_integrantes || ids.length > topic.max_integrantes) throw new ConflictException('La composición ya no está dentro del rango del tema.');
      return ids;
    }
    if (!app.estudiante) throw new ConflictException('La modalidad de la postulación no es válida.');
    const ids = [app.estudiante.id];
    await this.validateParticipants(manager, app.periodo.id, ids, start);
    if (1 < topic.min_integrantes || 1 > topic.max_integrantes) throw new ConflictException('El tema no admite una postulación individual.');
    return ids;
  }

  private async validateParticipants(manager: EntityManager, periodoId: string, ids: string[], start: Date): Promise<void> {
    for (const id of [...ids].sort()) {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 7319))', [id]);
      await this.habilitados.getEligibleStudentForGroup(periodoId, id, manager);
      const eligible = await manager.getRepository(EstudianteHabilitado).findOne({ where: { periodo: { id: periodoId }, estudiante: { id } } });
      if (!eligible || (eligible.situacion_ingreso !== SituacionIngreso.ADMITIDO && (eligible.situacion_ingreso !== SituacionIngreso.PENDIENTE || new Date() >= start))) throw new ConflictException('Los condicionados solo pueden recibir asignación antes del inicio de titulación.');
    }
  }

  private async isCandidateEligible(manager: EntityManager, app: Postulacion, topic: Tema, start: Date): Promise<boolean> {
    try {
      if (app.estado !== EstadoPostulacion.PENDIENTE || app.num_integrantes < topic.min_integrantes || app.num_integrantes > topic.max_integrantes) return false;
      await this.validateApplication(manager, app, topic, start);
      return true;
    } catch { return false; }
  }

  private async toResponse(item: AsignacionTema): Promise<AsignacionTemaResponseDto> {
    const schema = this.schema(this.dataSource.manager);
    const participantRows = await this.dataSource.query(`SELECT e."id",u."nombres",u."apellidos",e."matricula",h."situacion_ingreso"::text AS situacion_ingreso FROM ${schema}."estudiante" e JOIN ${schema}."usuario" u ON u."id"=e."usuario_id" LEFT JOIN ${schema}."estudiante_habilitado" h ON h."periodo_id"=$1 AND h."estudiante_id"=e."id" WHERE ($2::uuid IS NOT NULL AND e."id"=$2) OR ($3::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM ${schema}."grupo_integrante" gi WHERE gi."grupo_id"=$3 AND gi."estudiante_id"=e."id")) ORDER BY e."id"`, [item.periodo_id, item.estudiante_id, item.grupo_id]) as Array<{ id: string; nombres: string; apellidos: string; matricula: string; situacion_ingreso: string | null }>;
    return {
      id: item.id, periodo_id: item.periodo_id, tema_id: item.tema_id,
      tema: { id: item.tema.id, titulo: item.tema.titulo, estado: item.tema.estado },
      postulacion_id: item.postulacion_id,
      postulacion: { id: item.postulacion.id, estado: item.postulacion.estado, modalidad: item.grupo_id ? ModalidadPostulacion.GRUPAL : ModalidadPostulacion.INDIVIDUAL, num_integrantes: item.postulacion.num_integrantes },
      grupo_id: item.grupo_id, grupo: item.grupo ? { id: item.grupo.id, nombre: item.grupo.nombre } : null,
      estudiante_id: item.estudiante_id, participantes: participantRows,
      aprobada_por_id: item.aprobada_por_id, aprobada_por: { id: item.aprobada_por.id, nombres: item.aprobada_por.nombres, apellidos: item.aprobada_por.apellidos },
      estado: item.estado, fecha_asignacion: item.fecha_asignacion, motivo: item.motivo,
      causa_anulacion: item.causa_anulacion, motivo_anulacion: item.motivo_anulacion, anulada_por_id: item.anulada_por_id, fecha_anulacion: item.fecha_anulacion,
    };
  }

  private topicValues(topic: Tema): Record<string, unknown> { return { periodo_id: topic.periodo.id, linea_id: topic.linea.id, docente_proponente_id: topic.docente_proponente.id, titulo: topic.titulo, descripcion: topic.descripcion, min_integrantes: topic.min_integrantes, max_integrantes: topic.max_integrantes, estado: topic.estado, creado_en: topic.creado_en }; }
  private schema(manager: EntityManager): string { const value = (manager.connection.options as PostgresConnectionOptions).schema ?? 'public'; if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new ServiceUnavailableException('El esquema PostgreSQL configurado no es válido.'); return `"${value}"`; }
  private handleDatabaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (error instanceof QueryFailedError) {
      const code = (error.driverError as PgError).code;
      if (code === '23505') throw new ConflictException('Existe una asignación vigente incompatible.');
      if (code === '23503' || code === '23514') throw new ConflictException('La asignación incumple una regla de integridad.');
      if (code === '40001' || code === '40P01') throw new ConflictException('La operación coincidió con otro cambio simultáneo. Vuelve a intentarlo.');
    }
    throw new ServiceUnavailableException('No se pudo completar la operación de asignación de tema en PostgreSQL.', { cause: error });
  }
}
