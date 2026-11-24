import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Postulacion } from '../postulaciones/entities/postulacion.entity.js';
import { EstadoPostulacion } from '../postulaciones/enums/estado-postulacion.enum.js';
import { Tema } from '../temas/entities/tema.entity.js';
import { TemaHistorial } from '../temas/entities/tema-historial.entity.js';
import { EstadoTema } from '../temas/enums/estado-tema.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { AsignacionTema } from './entities/asignacion-tema.entity.js';
import { AsignacionTemaCausa } from './enums/asignacion-tema-causa.enum.js';
import { AsignacionTemaEstado } from './enums/asignacion-tema-estado.enum.js';
import { AsignacionTutorPersistenciaService } from '../asignaciones-tutor/asignacion-tutor-persistencia.service.js';
import { GrupoIntegrantePersistenciaService } from '../grupos/grupo-integrante-persistencia.service.js';
import { NotificacionesPersistenciaService } from '../notificaciones/notificaciones-persistencia.service.js';
import { NotificacionTipo } from '../notificaciones/enums/notificacion-canal.enum.js';
import { AsignacionTemaOrigen } from './enums/asignacion-tema-origen.enum.js';

export interface AnulacionAsignacion {
  causa: AsignacionTemaCausa;
  motivo: string;
  accionPostulacion: string;
  accionTema: string;
}

@Injectable()
export class AsignacionTemaPersistenciaService {
  constructor(
    private readonly auditoria: AuditoriaService,
    private readonly asignacionesTutor: AsignacionTutorPersistenciaService,
    private readonly notificaciones: NotificacionesPersistenciaService,
    private readonly grupos: GrupoIntegrantePersistenciaService,
  ) {}

  async tieneVigenteParaEstudiante(manager: EntityManager, estudianteId: string): Promise<boolean> {
    const schema = this.schema(manager);
    const rows = await manager.query(`SELECT 1 FROM ${schema}."asignacion_tema" a WHERE a."estado"='VIGENTE' AND (a."estudiante_id"=$1 OR EXISTS (SELECT 1 FROM ${schema}."grupo_integrante" gi WHERE gi."grupo_id"=a."grupo_id" AND gi."estudiante_id"=$1 AND gi."estado"='ACTIVO')) LIMIT 1`, [estudianteId]) as unknown[];
    return rows.length > 0;
  }

  async tieneVigenteParaGrupo(manager: EntityManager, grupoId: string): Promise<boolean> {
    const result = await manager.getRepository(AsignacionTema).exist({ where: { grupo_id: grupoId, estado: AsignacionTemaEstado.VIGENTE } });
    return result;
  }

  /**
   * Once a topic is assigned it leaves the bank, so its open applications (PENDIENTE / EN_CONFLICTO)
   * in other periods are rejected with audit and notification. Applications of ARCHIVADO periods are
   * immutable history and are left untouched. Must run inside the assignment transaction.
   */
  async rechazarAbiertasDeOtrosPeriodos(manager: EntityManager, temaId: string, periodoId: string, motivo: string, actor: Usuario, ip: string | null): Promise<void> {
    const schema = this.schema(manager);
    const rows = await manager.query(
      `SELECT p."id" FROM ${schema}."postulacion" p WHERE p."tema_id"=$1 AND p."periodo_id"<>$2 AND p."estado" IN ('PENDIENTE_CONFIRMACION','PENDIENTE','EN_CONFLICTO') AND NOT EXISTS (SELECT 1 FROM ${schema}."periodo_titulacion" pe WHERE pe."id"=p."periodo_id" AND pe."estado"='ARCHIVADO') ORDER BY p."id" FOR UPDATE OF p`,
      [temaId, periodoId],
    ) as Array<{ id: string }>;
    const repository = manager.getRepository(Postulacion);
    const observacion = `Tema asignado en otro período: ${motivo.trim()}`;
    for (const row of rows) {
      const application = await repository.findOneBy({ id: row.id });
      if (!application || ![EstadoPostulacion.PENDIENTE_CONFIRMACION, EstadoPostulacion.PENDIENTE, EstadoPostulacion.EN_CONFLICTO].includes(application.estado)) continue;
      const previous = { estado: application.estado, observacion: application.observacion };
      application.estado = EstadoPostulacion.RECHAZADA;
      application.observacion = observacion;
      await repository.save(application);
      await this.auditoria.registrar(manager, {
        actor, accion: 'RECHAZAR_POSTULACION_POR_ASIGNACION_TEMA', entidad_tipo: 'postulacion', entidad_id: application.id,
        valores_anteriores: previous, valores_nuevos: { estado: application.estado, observacion }, ip_origen: ip,
      });
      await this.notificaciones.postulacion(manager, application.id, NotificacionTipo.POSTULACION_RECHAZADA, actor.id);
    }
  }

  async anularPorIncumplimiento(
    manager: EntityManager,
    periodoId: string,
    estudianteId: string,
    actor: Usuario,
    observacion: string,
    ip: string | null,
  ): Promise<void> {
    const schema = this.schema(manager);
    const candidatas = await manager.query(`SELECT a."id" FROM ${schema}."asignacion_tema" a WHERE a."periodo_id"=$1 AND a."estado"='VIGENTE' AND (a."estudiante_id"=$2 OR EXISTS (SELECT 1 FROM ${schema}."grupo_integrante" gi WHERE gi."grupo_id"=a."grupo_id" AND gi."estudiante_id"=$2 AND gi."estado"='ACTIVO'))`, [periodoId, estudianteId]) as Array<{ id: string }>;
    const rows = await this.bloquearAsignaciones(manager, candidatas.map((row) => row.id));
    for (const row of rows) {
      if (row.estado !== AsignacionTemaEstado.VIGENTE) continue;
      await this.anularBloqueada(manager, row.id, {
        causa: AsignacionTemaCausa.INCUMPLIMIENTO_CONDICION,
        motivo: observacion,
        accionPostulacion: 'ANULAR_POSTULACION_INCUMPLIMIENTO',
        accionTema: 'REPUBLICAR_TEMA_INCUMPLIMIENTO',
      }, actor, ip);
    }
  }

  /**
   * Bloquea tema, postulación y asignación (mismo orden que la anulación por incumplimiento)
   * y devuelve el estado actual de la asignación, o null si no existe en el período.
   */
  async bloquearParaAnulacion(manager: EntityManager, periodoId: string, asignacionId: string): Promise<AsignacionTemaEstado | null> {
    const schema = this.schema(manager);
    const existe = await manager.query(`SELECT 1 FROM ${schema}."asignacion_tema" WHERE "id"=$1 AND "periodo_id"=$2`, [asignacionId, periodoId]) as unknown[];
    if (!existe.length) return null;
    const rows = await this.bloquearAsignaciones(manager, [asignacionId]);
    return rows[0]?.estado ?? null;
  }

  /**
   * Bloquea en el orden tema → postulación → asignación (el de la anulación desde su origen).
   * Las asignaciones administrativas no tienen postulación; por eso cada tabla se bloquea en su
   * propia sentencia (FOR UPDATE no admite el lado anulable de un LEFT JOIN).
   */
  private async bloquearAsignaciones(manager: EntityManager, ids: string[]): Promise<Array<{ id: string; estado: AsignacionTemaEstado }>> {
    if (!ids.length) return [];
    const schema = this.schema(manager);
    const refs = await manager.query(`SELECT a."id",a."tema_id",a."postulacion_id" FROM ${schema}."asignacion_tema" a WHERE a."id"=ANY($1::uuid[])`, [ids]) as Array<{ id: string; tema_id: string; postulacion_id: string | null }>;
    await manager.query(`SELECT 1 FROM ${schema}."tema" WHERE "id"=ANY($1::uuid[]) ORDER BY "id" FOR UPDATE`, [refs.map((ref) => ref.tema_id)]);
    const postulaciones = refs.map((ref) => ref.postulacion_id).filter((id): id is string => id !== null);
    if (postulaciones.length) await manager.query(`SELECT 1 FROM ${schema}."postulacion" WHERE "id"=ANY($1::uuid[]) ORDER BY "id" FOR UPDATE`, [postulaciones]);
    return await manager.query(`SELECT "id","estado"::text AS estado FROM ${schema}."asignacion_tema" WHERE "id"=ANY($1::uuid[]) ORDER BY "tema_id","id" FOR UPDATE`, [ids]) as Array<{ id: string; estado: AsignacionTemaEstado }>;
  }

  /**
   * Anula una asignación VIGENTE ya bloqueada: asignación ANULADA con la causa indicada,
   * tutor vigente terminado, postulación ACEPTADA → ANULADA, tema ASIGNADO → PUBLICADO con
   * historial, auditorías y aviso TEMA_ANULADO. Las postulaciones rechazadas no se reactivan.
   * Un equipo administrativo grupal se disuelve en esta misma transacción, después de persistir
   * la anulación, para que sus estudiantes puedan volver a conformar un equipo. Una postulación
   * no disuelve su grupo.
   */
  async anularBloqueada(manager: EntityManager, asignacionId: string, anulacion: AnulacionAsignacion, actor: Usuario, ip: string | null): Promise<void> {
    const motivo = anulacion.motivo.trim();
    const assignmentRepo = manager.getRepository(AsignacionTema);
    const assignment = await assignmentRepo.findOneByOrFail({ id: asignacionId });
    const postRepo = manager.getRepository(Postulacion);
    // Las asignaciones administrativas (origen ADMIN) no tienen postulación que anular.
    const application = assignment.postulacion_id ? await postRepo.findOneByOrFail({ id: assignment.postulacion_id }) : null;
    const topicRepo = manager.getRepository(Tema);
    const topic = await topicRepo.findOneOrFail({ where: { id: assignment.tema_id }, relations: { linea: true, docente_proponente: true } });
    const previousAssignment = { estado: assignment.estado, causa_anulacion: assignment.causa_anulacion, motivo_anulacion: assignment.motivo_anulacion, anulada_por_id: assignment.anulada_por_id, fecha_anulacion: assignment.fecha_anulacion };
    const previousApplication = application ? { estado: application.estado, observacion: application.observacion } : null;
    const previousTopic = this.topicValues(topic);
    const now = new Date();

    assignment.estado = AsignacionTemaEstado.ANULADA;
    assignment.causa_anulacion = anulacion.causa;
    assignment.motivo_anulacion = motivo;
    assignment.anulada_por_id = actor.id;
    assignment.anulada_por = actor;
    assignment.fecha_anulacion = now;
    await assignmentRepo.save(assignment);
    await this.asignacionesTutor.anularPorAsignacionTema(manager, assignment.periodo_id, assignment.id, motivo, actor, ip);

    if (application) {
      application.estado = EstadoPostulacion.ANULADA;
      application.observacion = motivo;
      await postRepo.save(application);
    }

    topic.estado = EstadoTema.PUBLICADO;
    await topicRepo.save(topic);
    const nextTopic = this.topicValues(topic);
    await manager.getRepository(TemaHistorial).save(manager.getRepository(TemaHistorial).create({
      tema: topic, usuario: actor, estado_anterior: EstadoTema.ASIGNADO, estado_nuevo: EstadoTema.PUBLICADO,
      cambios: { anteriores: previousTopic, nuevos: nextTopic }, fecha: now,
    }));
    await this.auditoria.registrar(manager, { actor, accion: 'ANULAR_ASIGNACION_TEMA', entidad_tipo: 'asignacion_tema', entidad_id: assignment.id, valores_anteriores: previousAssignment, valores_nuevos: { estado: assignment.estado, causa_anulacion: assignment.causa_anulacion, motivo_anulacion: motivo, anulada_por_id: actor.id, fecha_anulacion: now }, ip_origen: ip });
    if (application) await this.auditoria.registrar(manager, { actor, accion: anulacion.accionPostulacion, entidad_tipo: 'postulacion', entidad_id: application.id, valores_anteriores: previousApplication, valores_nuevos: { estado: application.estado, observacion: application.observacion }, ip_origen: ip });
    await this.auditoria.registrar(manager, { actor, accion: anulacion.accionTema, entidad_tipo: 'tema', entidad_id: topic.id, valores_anteriores: previousTopic, valores_nuevos: nextTopic, ip_origen: ip });
    await this.notificaciones.asignacionTema(manager, assignment.id, NotificacionTipo.TEMA_ANULADO, actor.id);
    if (assignment.origen === AsignacionTemaOrigen.ADMIN && assignment.grupo_id) {
      await this.grupos.disolverEquipoAdministrativo(manager, assignment.grupo_id, actor, motivo, ip);
    }
  }

  private topicValues(topic: Tema): Record<string, unknown> {
    return { tema_id: topic.id, carrera_id: topic.carrera_id, estado: topic.estado, titulo: topic.titulo, linea_id: topic.linea.id, docente_proponente_id: topic.docente_proponente.id, tipo: topic.tipo };
  }

  private schema(manager: EntityManager): string {
    const value = (manager.connection.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('El esquema PostgreSQL configurado no es válido.');
    return `"${value}"`;
  }
}
