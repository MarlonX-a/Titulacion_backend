import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schema(queryRunner: QueryRunner): string {
  const name = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error('El esquema configurado para notificaciones no es válido.');
  return `"${name}"`;
}

export class EnforceNotificationEmailDelivery20261014100000 implements MigrationInterface {
  name = 'EnforceNotificationEmailDelivery20261014100000';
  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schema(queryRunner);
    await queryRunner.query(`CREATE FUNCTION ${s}."proteger_entrega_correo_notificacion"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='DELETE' THEN RAISE EXCEPTION 'las solicitudes de entrega son históricas' USING ERRCODE='23514'; END IF;
        IF TG_OP='UPDATE' AND NEW."notificacion_id" IS DISTINCT FROM OLD."notificacion_id" THEN RAISE EXCEPTION 'la referencia del correo no puede cambiar' USING ERRCODE='23514'; END IF;
        IF TG_OP <> 'DELETE' AND NOT EXISTS (SELECT 1 FROM ${s}."notificacion" n WHERE n."id"=NEW."notificacion_id" AND n."canal"='EMAIL') THEN
          RAISE EXCEPTION 'la entrega debe corresponder a una notificación por correo' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$`);
    await queryRunner.query(`CREATE TRIGGER "TRG_entrega_correo_notificacion_proteger" BEFORE INSERT OR UPDATE OR DELETE ON ${s}."entrega_correo_notificacion" FOR EACH ROW EXECUTE FUNCTION ${s}."proteger_entrega_correo_notificacion"()`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schema(queryRunner);
    await queryRunner.query(`DROP TRIGGER "TRG_entrega_correo_notificacion_proteger" ON ${s}."entrega_correo_notificacion"`);
    await queryRunner.query(`DROP FUNCTION ${s}."proteger_entrega_correo_notificacion"()`);
  }
}
