import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { NotificacionTipo } from '../notificaciones/enums/notificacion-canal.enum.js';
import { NotificacionesPersistenciaService } from '../notificaciones/notificaciones-persistencia.service.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { Postulacion } from './entities/postulacion.entity.js';
import { EstadoPostulacion } from './enums/estado-postulacion.enum.js';

/** Acción de auditoría con la que se registra una cancelación de postulación. */
export type AccionCancelarPostulacion = 'CANCELAR_POSTULACION' | 'CANCELAR_POSTULACION_NO_ADMISION';

@Injectable()
export class PostulacionPersistenciaService {
  constructor(
    private readonly auditoria: AuditoriaService,
    private readonly notificaciones: NotificacionesPersistenciaService,
  ) {}

  private schema(manager: EntityManager): string {
    const schema = (manager.connection.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema PostgreSQL configurado no es válido.');
    return `"${schema}"`;
  }

  async grupoTienePostulaciones(manager: EntityManager, grupoId: string): Promise<boolean> {
    const rows = await manager.query(`SELECT 1 FROM ${this.schema(manager)}."postulacion" WHERE "grupo_id" = $1 LIMIT 1`, [grupoId]) as unknown[];
    return rows.length > 0;
  }

  async estudianteTienePostulacionIndividualActiva(manager: EntityManager, periodoId: string, estudianteId: string): Promise<boolean> {
    const rows = await manager.query(`SELECT 1 FROM ${this.schema(manager)}."postulacion" WHERE "periodo_id" = $1 AND "estudiante_id" = $2 AND "estado" IN ('PENDIENTE','EN_CONFLICTO','ACEPTADA') LIMIT 1`, [periodoId, estudianteId]) as unknown[];
    return rows.length > 0;
  }

  /**
   * Transición PENDIENTE → CANCELADA de una postulación ya bloqueada por el llamador:
   * guarda el motivo como observación, audita y notifica POSTULACION_CANCELADA.
   */
  async cancelar(
    manager: EntityManager,
    item: Postulacion,
    actor: Usuario,
    motivo: string,
    ip: string | null,
    accion: AccionCancelarPostulacion = 'CANCELAR_POSTULACION',
  ): Promise<void> {
    const before = { estado: item.estado, observacion: item.observacion };
    item.estado = EstadoPostulacion.CANCELADA;
    item.observacion = motivo.trim();
    await manager.getRepository(Postulacion).save(item);
    await this.auditoria.registrar(manager, { actor, accion, entidad_tipo: 'postulacion', entidad_id: item.id, valores_anteriores: before, valores_nuevos: { estado: item.estado, observacion: item.observacion }, ip_origen: ip });
    await this.notificaciones.postulacion(manager, item.id, NotificacionTipo.POSTULACION_CANCELADA, actor.id);
  }

  /**
   * Cancela las postulaciones PENDIENTE del período en las que participa un estudiante que quedó
   * NO_ADMITIDO: la individual y la del grupo al que pertenece activamente. Una postulación grupal
   * congela su número de integrantes y exige participantes elegibles, por lo que deja de ser válida
   * aunque el tema admita el nuevo tamaño. EN_CONFLICTO no admite la transición a CANCELADA en
   * PostgreSQL y ACEPTADA la resuelve la anulación de la asignación, por lo que no se tocan aquí.
   * Bloquea grupo → postulaciones (mismo orden que la gestión de postulaciones grupales).
   * Devuelve los identificadores cancelados.
   */
  async cancelarPendientesPorNoAdmision(
    manager: EntityManager,
    periodoId: string,
    estudianteId: string,
    actor: Usuario,
    motivo: string,
    ip: string | null,
  ): Promise<string[]> {
    const s = this.schema(manager);
    const groups = await manager.query(`SELECT g."id" FROM ${s}."grupo" g JOIN ${s}."grupo_integrante" gi ON gi."grupo_id"=g."id" WHERE gi."periodo_id"=$1 AND gi."estudiante_id"=$2 AND gi."estado"='ACTIVO' ORDER BY g."id" FOR UPDATE OF g`, [periodoId, estudianteId]) as Array<{ id: string }>;
    const groupIds = groups.map((row) => row.id);
    const rows = await manager.query(`SELECT p."id" FROM ${s}."postulacion" p WHERE p."periodo_id"=$1 AND p."estado"='PENDIENTE' AND (p."estudiante_id"=$2 OR p."grupo_id"=ANY($3::uuid[])) ORDER BY p."id" FOR UPDATE`, [periodoId, estudianteId, groupIds]) as Array<{ id: string }>;
    const repo = manager.getRepository(Postulacion);
    const cancelled: string[] = [];
    for (const row of rows) {
      const item = await repo.findOneByOrFail({ id: row.id });
      if (item.estado !== EstadoPostulacion.PENDIENTE) continue;
      await this.cancelar(manager, item, actor, motivo, ip, 'CANCELAR_POSTULACION_NO_ADMISION');
      cancelled.push(item.id);
    }
    return cancelled;
  }
}
