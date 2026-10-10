import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { Invitacion } from './entities/invitacion.entity.js';
import { InvitacionEstado } from './enums/invitacion-estado.enum.js';
import { NotificacionesPersistenciaService } from '../notificaciones/notificaciones-persistencia.service.js';
import { NotificacionTipo } from '../notificaciones/enums/notificacion-canal.enum.js';

@Injectable()
export class InvitacionPersistenciaService {
  constructor(private readonly auditoria: AuditoriaService, private readonly notificaciones: NotificacionesPersistenciaService) {}

  async resolverPendientesDelGrupo(
    manager: EntityManager,
    grupoId: string,
    actor: Usuario,
    motivo: string,
    ip: string | null,
    accion: 'CAMBIAR_REPRESENTANTE' | 'DISOLVER_GRUPO' | 'POSTULAR_GRUPO',
  ): Promise<void> {
    const schema = (manager.connection.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema PostgreSQL configurado no es válido.');
    const rows = await manager.query(
      `SELECT "id", "estado", "expira_en" FROM "${schema}"."invitacion" WHERE "grupo_id" = $1 AND "estado" = $2 ORDER BY "id" FOR UPDATE`,
      [grupoId, InvitacionEstado.PENDIENTE],
    ) as Array<{ id: string; estado: InvitacionEstado; expira_en: Date }>;
    const repo = manager.getRepository(Invitacion);
    for (const row of rows) {
      const item = await repo.findOneByOrFail({ id: row.id });
      const anterior = { estado: item.estado, fecha_respuesta: item.fecha_respuesta };
      const expired = item.expira_en.getTime() <= Date.now();
      item.estado = expired ? InvitacionEstado.EXPIRADA : InvitacionEstado.CANCELADA;
      item.fecha_respuesta = expired ? item.expira_en : new Date();
      await repo.save(item);
      await this.auditoria.registrar(manager, {
        actor,
        accion: expired ? 'REGISTRAR_EXPIRACION_INVITACION' : 'CANCELAR_INVITACION_GRUPO',
        entidad_tipo: 'invitacion',
        entidad_id: item.id,
        valores_anteriores: anterior,
        valores_nuevos: { estado: item.estado, fecha_respuesta: item.fecha_respuesta, motivo, causa: accion },
        ip_origen: ip,
      });
      await this.notificaciones.invitacion(manager, item.id, expired ? NotificacionTipo.INVITACION_EXPIRADA : NotificacionTipo.INVITACION_CANCELADA, actor.id);
    }
  }
}
