import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schema(queryRunner: QueryRunner): string {
  const name = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error('El esquema configurado para notificaciones no es válido.');
  return `"${name}"`;
}

const previousTypes = [
  'PAT_ENTREGADO', 'PAT_REVISADO', 'INVITACION_RECIBIDA', 'INVITACION_ACEPTADA',
  'INVITACION_RECHAZADA', 'INVITACION_CANCELADA', 'INVITACION_EXPIRADA',
  'POSTULACION_REGISTRADA', 'POSTULACION_CANCELADA', 'POSTULACION_RECHAZADA',
  'TEMA_ASIGNADO', 'TEMA_ANULADO', 'TUTOR_ASIGNADO', 'TUTOR_REEMPLAZADO', 'INGRESO_RESUELTO',
];
const newTypes = ['CUENTA_ACTIVADA', 'ACTIVACIONES_MASIVAS'];
const list = (types: string[]) => types.map((type) => `'${type}'`).join(',');
const previousEntityCheck = `("tipo" IN ('PAT_ENTREGADO') AND "entidad_tipo"='documento_pat') OR ("tipo"='PAT_REVISADO' AND "entidad_tipo"='revision_pat') OR ("tipo" LIKE 'INVITACION_%' AND "entidad_tipo"='invitacion') OR ("tipo" LIKE 'POSTULACION_%' AND "entidad_tipo"='postulacion') OR ("tipo" IN ('TEMA_ASIGNADO','TEMA_ANULADO') AND "entidad_tipo"='asignacion_tema') OR ("tipo" IN ('TUTOR_ASIGNADO','TUTOR_REEMPLAZADO') AND "entidad_tipo"='asignacion_tutor') OR ("tipo"='INGRESO_RESUELTO' AND "entidad_tipo"='estudiante_habilitado')`;
const entityCheck = `${previousEntityCheck} OR ("tipo"='CUENTA_ACTIVADA' AND "entidad_tipo"='usuario') OR ("tipo"='ACTIVACIONES_MASIVAS' AND "entidad_tipo"='seguridad')`;

/**
 * Amplía los tipos de notificación con los avisos de seguridad del primer acceso (S2):
 * `CUENTA_ACTIVADA` al titular y `ACTIVACIONES_MASIVAS` a ADMIN. Solo cambia dos CHECK;
 * no toca columnas ni datos.
 */
export class NotificacionesCuentaSeguridad20261112100000 implements MigrationInterface {
  name = 'NotificacionesCuentaSeguridad20261112100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schema(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."notificacion" IN ACCESS EXCLUSIVE MODE`);
    await queryRunner.query(`ALTER TABLE ${s}."notificacion" DROP CONSTRAINT "CHK_notificacion_tipo_pat", DROP CONSTRAINT "CHK_notificacion_entidad_pat"`);
    await queryRunner.query(`ALTER TABLE ${s}."notificacion" ADD CONSTRAINT "CHK_notificacion_tipo_pat" CHECK ("tipo" IN (${list([...previousTypes, ...newTypes])})), ADD CONSTRAINT "CHK_notificacion_entidad_pat" CHECK (${entityCheck})`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schema(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."notificacion" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(`SELECT count(*)::integer AS total FROM ${s}."notificacion" WHERE "tipo" IN (${list(newTypes)})`) as Array<{ total: number }>;
    if (Number(rows[0]?.total ?? 0) > 0) throw new Error('No se puede revertir: existen notificaciones de activación de cuenta; se conservan como historial.');
    await queryRunner.query(`ALTER TABLE ${s}."notificacion" DROP CONSTRAINT "CHK_notificacion_tipo_pat", DROP CONSTRAINT "CHK_notificacion_entidad_pat"`);
    await queryRunner.query(`ALTER TABLE ${s}."notificacion" ADD CONSTRAINT "CHK_notificacion_tipo_pat" CHECK ("tipo" IN (${list(previousTypes)})), ADD CONSTRAINT "CHK_notificacion_entidad_pat" CHECK (${previousEntityCheck})`);
  }
}
