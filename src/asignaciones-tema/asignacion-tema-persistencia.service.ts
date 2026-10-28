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
import { NotificacionesPersistenciaService } from '../notificaciones/notificaciones-persistencia.service.js';
import { NotificacionTipo } from '../notificaciones/enums/notificacion-canal.enum.js';

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

  async anularPorIncumplimiento(
    manager: EntityManager,
    periodoId: string,
    estudianteId: string,
    actor: Usuario,
    observacion: string,
    ip: string | null,
  ): Promise<void> {
    const schema = this.schema(manager);
    const rows = await manager.query(`SELECT a."id" FROM ${schema}."asignacion_tema" a JOIN ${schema}."postulacion" p ON p."id"=a."postulacion_id" JOIN ${schema}."tema" t ON t."id"=a."tema_id" WHERE a."periodo_id"=$1 AND a."estado"='VIGENTE' AND (a."estudiante_id"=$2 OR EXISTS (SELECT 1 FROM ${schema}."grupo_integrante" gi WHERE gi."grupo_id"=a."grupo_id" AND gi."estudiante_id"=$2 AND gi."estado"='ACTIVO')) ORDER BY t."id",p."id",a."id" FOR UPDATE OF t,p,a`, [periodoId, estudianteId]) as Array<{ id: string }>;
    for (const row of rows) {
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
    const rows = await manager.query(`SELECT a."id",a."estado"::text AS estado FROM ${schema}."asignacion_tema" a JOIN ${schema}."postulacion" p ON p."id"=a."postulacion_id" JOIN ${schema}."tema" t ON t."id"=a."tema_id" WHERE a."id"=$1 AND a."periodo_id"=$2 ORDER BY t."id",p."id",a."id" FOR UPDATE OF t,p,a`, [asignacionId, periodoId]) as Array<{ id: string; estado: AsignacionTemaEstado }>;
    return rows[0]?.estado ?? null;
  }

  /**
   * Anula una asignación VIGENTE ya bloqueada: asignación ANULADA con la causa indicada,
   * tutor vigente terminado, postulación ACEPTADA → ANULADA, tema ASIGNADO → PUBLICADO con
   * historial, auditorías y aviso TEMA_ANULADO. Las postulaciones rechazadas no se reactivan.
   */
  async anularBloqueada(manager: EntityManager, asignacionId: string, anulacion: AnulacionAsignacion, actor: Usuario, ip: string | null): Promise<void> {
    const motivo = anulacion.motivo.trim();
    const assignmentRepo = manager.getRepository(AsignacionTema);
    const assignment = await assignmentRepo.findOneByOrFail({ id: asignacionId });
    const postRepo = manager.getRepository(Postulacion);
    const application = await postRepo.findOneByOrFail({ id: assignment.postulacion_id });
    const topicRepo = manager.getRepository(Tema);
    const topic = await topicRepo.findOneOrFail({ where: { id: assignment.tema_id }, relations: { periodo: true, linea: true, docente_proponente: true } });
    const previousAssignment = { estado: assignment.estado, causa_anulacion: assignment.causa_anulacion, motivo_anulacion: assignment.motivo_anulacion, anulada_por_id: assignment.anulada_por_id, fecha_anulacion: assignment.fecha_anulacion };
    const previousApplication = { estado: application.estado, observacion: application.observacion };
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

    application.estado = EstadoPostulacion.ANULADA;
    application.observacion = motivo;
    await postRepo.save(application);

    topic.estado = EstadoTema.PUBLICADO;
    await topicRepo.save(topic);
    const nextTopic = this.topicValues(topic);
    await manager.getRepository(TemaHistorial).save(manager.getRepository(TemaHistorial).create({
      tema: topic, usuario: actor, estado_anterior: EstadoTema.ASIGNADO, estado_nuevo: EstadoTema.PUBLICADO,
      cambios: { anteriores: previousTopic, nuevos: nextTopic }, fecha: now,
    }));
    await this.auditoria.registrar(manager, { actor, accion: 'ANULAR_ASIGNACION_TEMA', entidad_tipo: 'asignacion_tema', entidad_id: assignment.id, valores_anteriores: previousAssignment, valores_nuevos: { estado: assignment.estado, causa_anulacion: assignment.causa_anulacion, motivo_anulacion: motivo, anulada_por_id: actor.id, fecha_anulacion: now }, ip_origen: ip });
    await this.auditoria.registrar(manager, { actor, accion: anulacion.accionPostulacion, entidad_tipo: 'postulacion', entidad_id: application.id, valores_anteriores: previousApplication, valores_nuevos: { estado: application.estado, observacion: application.observacion }, ip_origen: ip });
    await this.auditoria.registrar(manager, { actor, accion: anulacion.accionTema, entidad_tipo: 'tema', entidad_id: topic.id, valores_anteriores: previousTopic, valores_nuevos: nextTopic, ip_origen: ip });
    await this.notificaciones.asignacionTema(manager, assignment.id, NotificacionTipo.TEMA_ANULADO, actor.id);
  }

  private topicValues(topic: Tema): Record<string, unknown> {
    return { tema_id: topic.id, periodo_id: topic.periodo.id, estado: topic.estado, titulo: topic.titulo, linea_id: topic.linea.id, docente_proponente_id: topic.docente_proponente.id, min_integrantes: topic.min_integrantes, max_integrantes: topic.max_integrantes };
  }

  private schema(manager: EntityManager): string {
    const value = (manager.connection.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('El esquema PostgreSQL configurado no es válido.');
    return `"${value}"`;
  }
}
