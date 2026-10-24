import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { NotificacionCanal, NotificacionTipo } from './enums/notificacion-canal.enum.js';

interface Recipient { usuario_id: string }
interface ContextRow { titulo: string; periodo: string; estado: string; version?: number; resultado?: string }

@Injectable()
export class NotificacionesPersistenciaService {
  constructor(private readonly dataSource: DataSource) {}

  async registrarEventoPat(manager: EntityManager, input: { tipo: 'PAT_ENTREGADO' | 'PAT_REVISADO'; entidadTipo: 'documento_pat' | 'revision_pat'; entidadId: string; documentoId: string; asignacionId: string; actorId: string; resultado?: string }): Promise<void> {
    const s = this.schema(manager);
    const rows = await manager.query(`SELECT t."titulo", p."nombre" AS periodo, d."version" FROM ${s}."documento_pat" d JOIN ${s}."asignacion_tema" a ON a."id"=d."asignacion_tema_id" JOIN ${s}."tema" t ON t."id"=a."tema_id" JOIN ${s}."periodo_titulacion" p ON p."id"=a."periodo_id" WHERE d."id"=$1 AND a."id"=$2`, [input.documentoId, input.asignacionId]) as ContextRow[];
    const context = rows[0];
    if (!context) throw new Error('No se encontró el contexto del evento PAT.');
    let recipients: Recipient[];
    if (input.tipo === NotificacionTipo.PAT_ENTREGADO) {
      recipients = await manager.query(`SELECT u."id" AS usuario_id FROM ${s}."usuario" u WHERE u."rol"='ADMIN' AND u."estado"='ACTIVO' UNION SELECT u."id" FROM ${s}."asignacion_tutor" at JOIN ${s}."docente" d ON d."id"=at."docente_id" JOIN ${s}."usuario" u ON u."id"=d."usuario_id" WHERE at."asignacion_tema_id"=$1 AND at."estado"='VIGENTE' AND u."estado"='ACTIVO'`, [input.asignacionId]) as Recipient[];
    } else {
      recipients = await manager.query(`SELECT u."id" AS usuario_id FROM ${s}."asignacion_tema" a LEFT JOIN ${s}."estudiante" e ON e."id"=a."estudiante_id" LEFT JOIN ${s}."grupo_integrante" gi ON gi."grupo_id"=a."grupo_id" AND gi."estado"='ACTIVO' LEFT JOIN ${s}."estudiante" ge ON ge."id"=gi."estudiante_id" JOIN ${s}."usuario" u ON u."id"=COALESCE(e."usuario_id",ge."usuario_id") WHERE a."id"=$1 AND u."estado"='ACTIVO' UNION SELECT u."id" FROM ${s}."asignacion_tutor" at JOIN ${s}."docente" d ON d."id"=at."docente_id" JOIN ${s}."usuario" u ON u."id"=d."usuario_id" WHERE at."asignacion_tema_id"=$1 AND at."estado"='VIGENTE' AND u."estado"='ACTIVO'`, [input.asignacionId]) as Recipient[];
    }
    const title = input.tipo === NotificacionTipo.PAT_ENTREGADO ? 'Nueva entrega PAT' : 'Revisión de PAT registrada';
    const detail = input.tipo === NotificacionTipo.PAT_ENTREGADO ? `se entregó la versión ${context.version}` : `la versión ${context.version} fue ${input.resultado?.toLowerCase() ?? 'revisada'}`;
    await this.registrar(manager, { tipo: input.tipo, entidadTipo: input.entidadTipo, entidadId: input.entidadId, actorId: input.actorId, recipients, title, message: `En el período «${context.periodo}», ${detail} del PAT del tema «${context.titulo}». Consulta el detalle en el sistema.` });
  }

  async invitacion(manager: EntityManager, id: string, tipo: NotificacionTipo, actorId: string): Promise<void> {
    const s = this.schema(manager);
    const rows = await manager.query(`SELECT g."nombre" AS titulo, p."nombre" AS periodo, i."estado", i."estudiante_emisor_id", i."estudiante_destino_id" FROM ${s}."invitacion" i JOIN ${s}."grupo" g ON g."id"=i."grupo_id" JOIN ${s}."periodo_titulacion" p ON p."id"=i."periodo_id" WHERE i."id"=$1`, [id]) as Array<ContextRow & { estudiante_emisor_id: string; estudiante_destino_id: string }>;
    const row = rows[0]; if (!row) throw new Error('No se encontró la invitación para notificar.');
    const students = tipo === NotificacionTipo.INVITACION_RECIBIDA ? [row.estudiante_destino_id] : tipo === NotificacionTipo.INVITACION_ACEPTADA || tipo === NotificacionTipo.INVITACION_RECHAZADA ? [row.estudiante_emisor_id] : [row.estudiante_emisor_id, row.estudiante_destino_id];
    const recipients = await this.usersForStudents(manager, students);
    const labels: Record<string, string> = { INVITACION_RECIBIDA: 'Tienes una nueva invitación', INVITACION_ACEPTADA: 'Invitación aceptada', INVITACION_RECHAZADA: 'Invitación rechazada', INVITACION_CANCELADA: 'Invitación cancelada', INVITACION_EXPIRADA: 'Invitación vencida' };
    await this.registrar(manager, { tipo, entidadTipo: 'invitacion', entidadId: id, actorId, recipients, title: labels[tipo] ?? 'Actualización de invitación', message: `La invitación del grupo «${row.titulo}» en el período «${row.periodo}» quedó ${row.estado.toLowerCase()}.` });
  }

  async postulacion(manager: EntityManager, id: string, tipo: NotificacionTipo.POSTULACION_REGISTRADA | NotificacionTipo.POSTULACION_CANCELADA | NotificacionTipo.POSTULACION_RECHAZADA, actorId: string): Promise<void> {
    const s = this.schema(manager);
    const rows = await manager.query(`SELECT t."titulo", pe."nombre" AS periodo, p."estado", d."usuario_id" AS proponente_usuario_id FROM ${s}."postulacion" p JOIN ${s}."tema" t ON t."id"=p."tema_id" JOIN ${s}."periodo_titulacion" pe ON pe."id"=p."periodo_id" JOIN ${s}."docente" d ON d."id"=t."docente_proponente_id" WHERE p."id"=$1`, [id]) as Array<ContextRow & { proponente_usuario_id: string }>;
    const row = rows[0]; if (!row) throw new Error('No se encontró la postulación para notificar.');
    const participants = await manager.query(`SELECT u."id" AS usuario_id FROM ${s}."postulacion" p LEFT JOIN ${s}."estudiante" e ON e."id"=p."estudiante_id" LEFT JOIN ${s}."grupo_integrante" gi ON gi."grupo_id"=p."grupo_id" AND gi."estado"='ACTIVO' LEFT JOIN ${s}."estudiante" ge ON ge."id"=gi."estudiante_id" JOIN ${s}."usuario" u ON u."id"=COALESCE(e."usuario_id",ge."usuario_id") WHERE p."id"=$1 AND u."estado"='ACTIVO' UNION SELECT u."id" FROM ${s}."postulacion" p JOIN ${s}."tema" t ON t."id"=p."tema_id" JOIN ${s}."docente" d ON d."id"=t."docente_proponente_id" JOIN ${s}."usuario" u ON u."id"=d."usuario_id" WHERE p."id"=$1 AND $2::text <> 'POSTULACION_RECHAZADA' AND u."estado"='ACTIVO'`, [id, tipo]) as Recipient[];
    const label = tipo === NotificacionTipo.POSTULACION_REGISTRADA ? 'Postulación registrada' : tipo === NotificacionTipo.POSTULACION_CANCELADA ? 'Postulación cancelada' : 'Postulación no seleccionada';
    await this.registrar(manager, { tipo, entidadTipo: 'postulacion', entidadId: id, actorId, recipients: participants, title: label, message: `La postulación al tema «${row.titulo}» del período «${row.periodo}» quedó ${row.estado.toLowerCase()}.` });
  }

  async asignacionTema(manager: EntityManager, id: string, tipo: NotificacionTipo.TEMA_ASIGNADO | NotificacionTipo.TEMA_ANULADO, actorId: string): Promise<void> {
    const s = this.schema(manager);
    const rows = await manager.query(`SELECT a."id", t."titulo", pe."nombre" AS periodo, a."estado", d."usuario_id" AS proponente_usuario_id FROM ${s}."asignacion_tema" a JOIN ${s}."tema" t ON t."id"=a."tema_id" JOIN ${s}."periodo_titulacion" pe ON pe."id"=a."periodo_id" JOIN ${s}."docente" d ON d."id"=t."docente_proponente_id" WHERE a."id"=$1`, [id]) as Array<ContextRow & { proponente_usuario_id: string }>;
    const row = rows[0]; if (!row) throw new Error('No se encontró la asignación de tema para notificar.');
    const recipients = await manager.query(`SELECT u."id" AS usuario_id FROM ${s}."asignacion_tema" a LEFT JOIN ${s}."estudiante" e ON e."id"=a."estudiante_id" LEFT JOIN ${s}."grupo_integrante" gi ON gi."grupo_id"=a."grupo_id" AND gi."estado"='ACTIVO' LEFT JOIN ${s}."estudiante" ge ON ge."id"=gi."estudiante_id" JOIN ${s}."usuario" u ON u."id"=COALESCE(e."usuario_id",ge."usuario_id") WHERE a."id"=$1 AND u."estado"='ACTIVO' UNION SELECT u."id" FROM ${s}."tema" t JOIN ${s}."docente" d ON d."id"=t."docente_proponente_id" JOIN ${s}."usuario" u ON u."id"=d."usuario_id" WHERE t."id"=(SELECT "tema_id" FROM ${s}."asignacion_tema" WHERE "id"=$1) AND u."estado"='ACTIVO' UNION SELECT u."id" FROM ${s}."asignacion_tema" a JOIN LATERAL (SELECT at."docente_id" FROM ${s}."asignacion_tutor" at WHERE at."asignacion_tema_id"=a."id" ORDER BY CASE WHEN at."estado"='VIGENTE' THEN 0 ELSE 1 END, at."fecha_asignacion" DESC, at."id" DESC LIMIT 1) latest ON true JOIN ${s}."docente" d ON d."id"=latest."docente_id" JOIN ${s}."usuario" u ON u."id"=d."usuario_id" WHERE a."id"=$1 AND u."estado"='ACTIVO' AND ($2='TEMA_ANULADO' OR EXISTS (SELECT 1 FROM ${s}."asignacion_tutor" at WHERE at."asignacion_tema_id"=a."id" AND at."estado"='VIGENTE')) ORDER BY 1`, [id, tipo]) as Recipient[];
    const label = tipo === NotificacionTipo.TEMA_ASIGNADO ? 'Tema asignado' : 'Asignación de tema anulada';
    const message = tipo === NotificacionTipo.TEMA_ASIGNADO ? `La postulación seleccionada fue aceptada y el tema «${row.titulo}» del período «${row.periodo}» quedó asignado.` : `La asignación del tema «${row.titulo}» del período «${row.periodo}» fue anulada. También se anuló la postulación aceptada y terminó la tutoría vigente, si existía.`;
    await this.registrar(manager, { tipo, entidadTipo: 'asignacion_tema', entidadId: id, actorId, recipients, title: label, message });
  }

  async tutor(manager: EntityManager, id: string, tipo: NotificacionTipo.TUTOR_ASIGNADO | NotificacionTipo.TUTOR_REEMPLAZADO, actorId: string): Promise<void> {
    const s = this.schema(manager);
    const rows = await manager.query(`SELECT at."id", t."titulo", p."nombre" AS periodo, at."estado", at."docente_id", a."id" AS trabajo_id FROM ${s}."asignacion_tutor" at JOIN ${s}."asignacion_tema" a ON a."id"=at."asignacion_tema_id" JOIN ${s}."tema" t ON t."id"=a."tema_id" JOIN ${s}."periodo_titulacion" p ON p."id"=a."periodo_id" WHERE at."id"=$1`, [id]) as Array<ContextRow & { docente_id: string; trabajo_id: string }>;
    const row = rows[0]; if (!row) throw new Error('No se encontró la asignación de tutor para notificar.');
    const recipients = await manager.query(`SELECT u."id" AS usuario_id FROM ${s}."asignacion_tema" a LEFT JOIN ${s}."estudiante" e ON e."id"=a."estudiante_id" LEFT JOIN ${s}."grupo_integrante" gi ON gi."grupo_id"=a."grupo_id" AND gi."estado"='ACTIVO' LEFT JOIN ${s}."estudiante" ge ON ge."id"=gi."estudiante_id" JOIN ${s}."usuario" u ON u."id"=COALESCE(e."usuario_id",ge."usuario_id") WHERE a."id"=$1 AND u."estado"='ACTIVO' UNION SELECT u."id" FROM ${s}."asignacion_tutor" at JOIN ${s}."docente" d ON d."id"=at."docente_id" JOIN ${s}."usuario" u ON u."id"=d."usuario_id" WHERE at."id"=$2 AND u."estado"='ACTIVO' UNION SELECT u."id" FROM ${s}."asignacion_tutor" anterior JOIN ${s}."docente" d ON d."id"=anterior."docente_id" JOIN ${s}."usuario" u ON u."id"=d."usuario_id" WHERE anterior."asignacion_tema_id"=$1 AND anterior."estado"='REEMPLAZADA' AND anterior."id"=(SELECT old."id" FROM ${s}."asignacion_tutor" old WHERE old."asignacion_tema_id"=$1 AND old."estado"='REEMPLAZADA' ORDER BY old."fecha_fin" DESC, old."id" DESC LIMIT 1) AND $3='TUTOR_REEMPLAZADO' AND u."estado"='ACTIVO' ORDER BY 1`, [row.trabajo_id, id, tipo]) as Recipient[];
    await this.registrar(manager, { tipo, entidadTipo: 'asignacion_tutor', entidadId: id, actorId, recipients, title: tipo === NotificacionTipo.TUTOR_ASIGNADO ? 'Tutor asignado' : 'Tutor reemplazado', message: `El tema «${row.titulo}» del período «${row.periodo}» tiene ${tipo === NotificacionTipo.TUTOR_ASIGNADO ? 'un tutor asignado' : 'un nuevo tutor'}.` });
  }

  async ingreso(manager: EntityManager, id: string, actorId: string): Promise<void> {
    const s = this.schema(manager);
    const rows = await manager.query(`SELECT u."id" AS usuario_id, h."situacion_ingreso", p."nombre" AS periodo FROM ${s}."estudiante_habilitado" h JOIN ${s}."estudiante" e ON e."id"=h."estudiante_id" JOIN ${s}."usuario" u ON u."id"=e."usuario_id" JOIN ${s}."periodo_titulacion" p ON p."id"=h."periodo_id" WHERE h."id"=$1 AND u."estado"='ACTIVO'`, [id]) as Array<Recipient & { situacion_ingreso: string; periodo: string }>;
    const row = rows[0]; if (!row) throw new Error('No se encontró la habilitación para notificar.');
    await this.registrar(manager, { tipo: NotificacionTipo.INGRESO_RESUELTO, entidadTipo: 'estudiante_habilitado', entidadId: id, actorId, recipients: [row], title: 'Situación de ingreso actualizada', message: `Tu situación de ingreso para el período «${row.periodo}» quedó ${row.situacion_ingreso.toLowerCase()}. Consulta el detalle en el sistema.` });
  }

  private async usersForStudents(manager: EntityManager, ids: string[]): Promise<Recipient[]> {
    if (!ids.length) return [];
    const s = this.schema(manager);
    return manager.query(`SELECT e."usuario_id" AS usuario_id FROM ${s}."estudiante" e JOIN ${s}."usuario" u ON u."id"=e."usuario_id" WHERE e."id"=ANY($1::uuid[]) AND u."estado"='ACTIVO'`, [ids]) as Promise<Recipient[]>;
  }

  private async registrar(manager: EntityManager, input: { tipo: string; entidadTipo: string; entidadId: string; actorId: string; recipients: Recipient[]; title: string; message: string }): Promise<void> {
    const s = this.schema(manager);
    const ids = [...new Set(input.recipients.map((recipient) => recipient.usuario_id))].filter((id) => id !== input.actorId);
    for (const id of ids) {
      for (const canal of [NotificacionCanal.EN_APP, NotificacionCanal.EMAIL]) {
        const inserted = await manager.query(`INSERT INTO ${s}."notificacion" ("usuario_id","tipo","titulo","mensaje","entidad_tipo","entidad_id","canal","leida","fecha_envio") SELECT u."id",$2,$3,$4,$5,$6,$7,false,CASE WHEN $8 THEN CURRENT_TIMESTAMP ELSE NULL END FROM ${s}."usuario" u WHERE u."id"=$1 AND u."estado"='ACTIVO' ON CONFLICT ("usuario_id","tipo","entidad_tipo","entidad_id","canal") DO NOTHING RETURNING "id"`, [id, input.tipo, input.title, input.message, input.entidadTipo, input.entidadId, canal, canal === NotificacionCanal.EN_APP]) as Array<{ id: string }>;
        if (canal === NotificacionCanal.EMAIL && inserted.length) {
          await manager.query(`INSERT INTO ${s}."entrega_correo_notificacion" ("notificacion_id") VALUES ($1) ON CONFLICT ("notificacion_id") DO NOTHING`, [inserted[0]!.id]);
        }
      }
    }
  }

  private schema(manager: EntityManager): string {
    const name = ((manager.connection.options ?? this.dataSource.options) as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error('El esquema PostgreSQL para notificaciones no es válido.');
    return `"${name}"`;
  }
}
