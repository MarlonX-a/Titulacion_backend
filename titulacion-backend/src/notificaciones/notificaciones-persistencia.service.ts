import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { Notificacion } from './entities/notificacion.entity.js';
import { EntregaCorreoNotificacion } from './entities/entrega-correo-notificacion.entity.js';
import { NotificacionCanal } from './enums/notificacion-canal.enum.js';

interface Destinatario { usuario_id: string }
interface TemaEvento { titulo: string; grupo_id: string | null; estudiante_usuario_id: string | null; version: number }
export type EventoPatTipo = 'PAT_ENTREGADO' | 'PAT_REVISADO';

@Injectable()
export class NotificacionesPersistenciaService {
  constructor(private readonly dataSource: DataSource) {}

  async registrarEventoPat(manager: EntityManager, input: { tipo: EventoPatTipo; entidadTipo: 'documento_pat' | 'revision_pat'; entidadId: string; documentoId: string; asignacionId: string; actorId: string; resultado?: string }): Promise<void> {
    const s = this.schema();
    const rows = await manager.query(
      `SELECT t."titulo", at."grupo_id", e."usuario_id" AS estudiante_usuario_id, d."version"
       FROM ${s}."documento_pat" d JOIN ${s}."asignacion_tema" at ON at."id"=d."asignacion_tema_id"
       JOIN ${s}."tema" t ON t."id"=at."tema_id"
       LEFT JOIN ${s}."estudiante" e ON e."id"=at."estudiante_id"
       WHERE d."id"=$1 AND at."id"=$2`, [input.documentoId, input.asignacionId],
    ) as TemaEvento[];
    const event = rows[0];
    if (!event) throw new Error('No se encontró el contexto del evento PAT.');

    let recipients: Destinatario[];
    if (input.tipo === 'PAT_ENTREGADO') {
      recipients = await manager.query(
        `SELECT u."id" AS usuario_id FROM ${s}."usuario" u WHERE u."rol"='ADMIN' AND u."estado"='ACTIVO'
         UNION SELECT u."id" FROM ${s}."asignacion_tutor" at
         JOIN ${s}."docente" d ON d."id"=at."docente_id" JOIN ${s}."usuario" u ON u."id"=d."usuario_id"
         WHERE at."asignacion_tema_id"=$1 AND at."estado"='VIGENTE' AND u."estado"='ACTIVO'`, [input.asignacionId],
      ) as Destinatario[];
    } else {
      recipients = await manager.query(
        `SELECT u."id" AS usuario_id FROM ${s}."asignacion_tema" at
         LEFT JOIN ${s}."estudiante" e ON e."id"=at."estudiante_id"
         LEFT JOIN ${s}."grupo_integrante" gi ON gi."grupo_id"=at."grupo_id" AND gi."estado"='ACTIVO'
         LEFT JOIN ${s}."estudiante" ge ON ge."id"=gi."estudiante_id"
         JOIN ${s}."usuario" u ON u."id"=COALESCE(e."usuario_id", ge."usuario_id")
         WHERE at."id"=$1 AND u."estado"='ACTIVO'
         UNION SELECT u."id" FROM ${s}."asignacion_tutor" at
         JOIN ${s}."docente" d ON d."id"=at."docente_id" JOIN ${s}."usuario" u ON u."id"=d."usuario_id"
         WHERE at."asignacion_tema_id"=$1 AND at."estado"='VIGENTE' AND u."estado"='ACTIVO'`, [input.asignacionId],
      ) as Destinatario[];
    }
    const uniqueRecipients = [...new Set(recipients.map((row) => row.usuario_id))].filter((id) => id !== input.actorId);
    if (!uniqueRecipients.length) return;

    const title = input.tipo === 'PAT_ENTREGADO' ? 'Nueva entrega PAT' : 'Revisión de PAT registrada';
    const message = input.tipo === 'PAT_ENTREGADO'
      ? `Se entregó la versión ${event.version} del PAT del tema «${event.titulo}».`
      : `La versión ${event.version} del PAT del tema «${event.titulo}» fue ${input.resultado?.toLowerCase() ?? 'revisada'}. Consulta el detalle y las observaciones en el sistema.`;
    const repository = manager.getRepository(Notificacion);
    for (const usuarioId of uniqueRecipients) {
      for (const canal of [NotificacionCanal.EN_APP, NotificacionCanal.EMAIL]) {
        const notification = await repository.save(repository.create({
          usuario_id: usuarioId, usuario: { id: usuarioId } as never, tipo: input.tipo,
          titulo: title, mensaje: message, entidad_tipo: input.entidadTipo, entidad_id: input.entidadId,
          canal, leida: false, fecha_creacion: new Date(), fecha_envio: canal === NotificacionCanal.EN_APP ? new Date() : null,
        }));
        if (canal === NotificacionCanal.EMAIL) {
          const deliveries = manager.getRepository(EntregaCorreoNotificacion);
          await deliveries.save(deliveries.create({ notificacion_id: notification.id, notificacion: notification }));
        }
      }
    }
  }

  private schema(): string {
    const name = (this.dataSource.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error('El esquema PostgreSQL para notificaciones no es válido.');
    return `"${name}"`;
  }
}
