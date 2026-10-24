import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schema(queryRunner: QueryRunner): string {
  const name = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error('El esquema configurado para notificaciones no es válido.');
  return `"${name}"`;
}

const types = [
  'PAT_ENTREGADO', 'PAT_REVISADO', 'INVITACION_RECIBIDA', 'INVITACION_ACEPTADA',
  'INVITACION_RECHAZADA', 'INVITACION_CANCELADA', 'INVITACION_EXPIRADA',
  'POSTULACION_REGISTRADA', 'POSTULACION_CANCELADA', 'POSTULACION_RECHAZADA',
  'TEMA_ASIGNADO', 'TEMA_ANULADO', 'TUTOR_ASIGNADO', 'TUTOR_REEMPLAZADO', 'INGRESO_RESUELTO',
];
const values = types.map((type) => `'${type}'`).join(',');
const entityCheck = `("tipo" IN ('PAT_ENTREGADO') AND "entidad_tipo"='documento_pat') OR ("tipo"='PAT_REVISADO' AND "entidad_tipo"='revision_pat') OR ("tipo" LIKE 'INVITACION_%' AND "entidad_tipo"='invitacion') OR ("tipo" LIKE 'POSTULACION_%' AND "entidad_tipo"='postulacion') OR ("tipo" IN ('TEMA_ASIGNADO','TEMA_ANULADO') AND "entidad_tipo"='asignacion_tema') OR ("tipo" IN ('TUTOR_ASIGNADO','TUTOR_REEMPLAZADO') AND "entidad_tipo"='asignacion_tutor') OR ("tipo"='INGRESO_RESUELTO' AND "entidad_tipo"='estudiante_habilitado')`;

export class ExtendProcessNotifications20261015100000 implements MigrationInterface {
  name = 'ExtendProcessNotifications20261015100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schema(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."notificacion", ${s}."entrega_correo_notificacion" IN ACCESS EXCLUSIVE MODE`);
    await queryRunner.query(`ALTER TABLE ${s}."notificacion" DROP CONSTRAINT "CHK_notificacion_tipo_pat", DROP CONSTRAINT "CHK_notificacion_entidad_pat"`);
    await queryRunner.query(`ALTER TABLE ${s}."notificacion" ADD CONSTRAINT "CHK_notificacion_tipo_pat" CHECK ("tipo" IN (${values})), ADD CONSTRAINT "CHK_notificacion_entidad_pat" CHECK (${entityCheck})`);
    await queryRunner.query(`ALTER TABLE ${s}."entrega_correo_notificacion" ADD COLUMN "generacion_reintento" integer NOT NULL DEFAULT 0, ADD COLUMN "reserva_token" uuid`);
    await queryRunner.query(`UPDATE ${s}."entrega_correo_notificacion" SET "reserva_token"=gen_random_uuid() WHERE "estado"='PROCESANDO' AND "reserva_hasta" IS NOT NULL`);
    await queryRunner.query(`ALTER TABLE ${s}."entrega_correo_notificacion" DROP CONSTRAINT "CHK_entrega_correo_notificacion_estado", ADD CONSTRAINT "CHK_entrega_correo_notificacion_estado" CHECK (("estado"='PROCESANDO') = ("reserva_hasta" IS NOT NULL) AND ("estado"='PROCESANDO') = ("reserva_token" IS NOT NULL) AND (("estado"='ENVIADO') = ("enviada_en" IS NOT NULL))), ADD CONSTRAINT "CHK_entrega_correo_notificacion_generacion" CHECK ("intentos" BETWEEN 0 AND 5 AND "generacion_reintento">=0)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schema(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."notificacion", ${s}."entrega_correo_notificacion" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(`SELECT count(*)::integer AS total FROM ${s}."notificacion" WHERE "tipo" NOT IN ('PAT_ENTREGADO','PAT_REVISADO')`) as Array<{ total: number }>;
    const active = await queryRunner.query(`SELECT count(*)::integer AS total FROM ${s}."entrega_correo_notificacion" WHERE "estado"='PROCESANDO'`) as Array<{ total: number }>;
    if (Number(rows[0]?.total ?? 0) > 0 || Number(active[0]?.total ?? 0) > 0) throw new Error('No se puede revertir: existen notificaciones nuevas o correos en procesamiento.');
    await queryRunner.query(`ALTER TABLE ${s}."entrega_correo_notificacion" DROP CONSTRAINT "CHK_entrega_correo_notificacion_generacion", DROP CONSTRAINT "CHK_entrega_correo_notificacion_estado", DROP COLUMN "reserva_token", DROP COLUMN "generacion_reintento"`);
    await queryRunner.query(`ALTER TABLE ${s}."entrega_correo_notificacion" ADD CONSTRAINT "CHK_entrega_correo_notificacion_estado" CHECK (("estado"='PROCESANDO') = ("reserva_hasta" IS NOT NULL) AND (("estado"='ENVIADO') = ("enviada_en" IS NOT NULL)))`);
    await queryRunner.query(`ALTER TABLE ${s}."notificacion" DROP CONSTRAINT "CHK_notificacion_tipo_pat", DROP CONSTRAINT "CHK_notificacion_entidad_pat"`);
    await queryRunner.query(`ALTER TABLE ${s}."notificacion" ADD CONSTRAINT "CHK_notificacion_tipo_pat" CHECK ("tipo" IN ('PAT_ENTREGADO','PAT_REVISADO')), ADD CONSTRAINT "CHK_notificacion_entidad_pat" CHECK (("tipo"='PAT_ENTREGADO' AND "entidad_tipo"='documento_pat') OR ("tipo"='PAT_REVISADO' AND "entidad_tipo"='revision_pat'))`);
  }
}
