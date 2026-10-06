import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaOf(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema configurado no es válido.');
  return `"${schema}"`;
}

export class CreatePasswordAuthentication20261006100000 implements MigrationInterface {
  name = 'CreatePasswordAuthentication20261006100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaOf(queryRunner);
    await queryRunner.query(`ALTER TABLE ${s}."usuario" ALTER COLUMN "id_externo_sso" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE ${s}."usuario" DROP CONSTRAINT "CHK_usuario_id_externo_sso_no_vacio"`);
    await queryRunner.query(`ALTER TABLE ${s}."usuario" ADD CONSTRAINT "CHK_usuario_id_externo_sso_no_vacio" CHECK ("id_externo_sso" IS NULL OR length(btrim("id_externo_sso")) > 0)`);
    await queryRunner.query(`
      CREATE TABLE ${s}."credencial_usuario" (
        "usuario_id" uuid NOT NULL,
        "password_hash" text,
        "requiere_cambio" boolean NOT NULL DEFAULT true,
        "temporal_expira_en" timestamptz,
        "version_sesion" integer NOT NULL DEFAULT 0,
        "actualizada_en" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_credencial_usuario" PRIMARY KEY ("usuario_id"),
        CONSTRAINT "FK_credencial_usuario_usuario" FOREIGN KEY ("usuario_id") REFERENCES ${s}."usuario"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_credencial_usuario_version" CHECK ("version_sesion" >= 0),
        CONSTRAINT "CHK_credencial_usuario_temporal" CHECK ("requiere_cambio" OR ("password_hash" IS NOT NULL AND "temporal_expira_en" IS NULL))
      )
    `);
    await queryRunner.query(`
      CREATE TABLE ${s}."sesion_usuario" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "usuario_id" uuid NOT NULL,
        "refresh_hash" char(64) NOT NULL,
        "refresh_anterior_hash" char(64),
        "expira_en" timestamptz NOT NULL,
        "revocada_en" timestamptz,
        "creada_en" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_sesion_usuario" PRIMARY KEY ("id"),
        CONSTRAINT "FK_sesion_usuario_usuario" FOREIGN KEY ("usuario_id") REFERENCES ${s}."usuario"("id") ON DELETE RESTRICT,
        CONSTRAINT "UQ_sesion_usuario_refresh" UNIQUE ("refresh_hash"),
        CONSTRAINT "CHK_sesion_usuario_vigencia" CHECK ("expira_en" > "creada_en")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_sesion_usuario_usuario" ON ${s}."sesion_usuario" ("usuario_id")`);
    await queryRunner.query(`CREATE TABLE ${s}."sesion_refresh_hash" (
      "sesion_id" uuid NOT NULL,
      "refresh_hash" char(64) NOT NULL,
      "creada_en" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "consumida_en" timestamptz,
      CONSTRAINT "PK_sesion_refresh_hash" PRIMARY KEY ("sesion_id", "refresh_hash"),
      CONSTRAINT "FK_sesion_refresh_hash_sesion" FOREIGN KEY ("sesion_id") REFERENCES ${s}."sesion_usuario"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`
      CREATE TABLE ${s}."solicitud_recuperacion" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "usuario_id" uuid NOT NULL,
        "codigo_hash" char(64) NOT NULL,
        "expira_en" timestamptz NOT NULL,
        "usada_en" timestamptz,
        CONSTRAINT "PK_solicitud_recuperacion" PRIMARY KEY ("id"),
        CONSTRAINT "FK_solicitud_recuperacion_usuario" FOREIGN KEY ("usuario_id") REFERENCES ${s}."usuario"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_solicitud_recuperacion_usuario_activa" ON ${s}."solicitud_recuperacion" ("usuario_id", "expira_en") WHERE "usada_en" IS NULL`);
    await queryRunner.query(`
      CREATE TABLE ${s}."correo_salida" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "usuario_id" uuid NOT NULL,
        "tipo" varchar(20) NOT NULL,
        "secreto_cifrado" text NOT NULL,
        "nonce" varchar(32) NOT NULL,
        "tag" varchar(32) NOT NULL,
        "expira_en" timestamptz NOT NULL,
        "enviado_en" timestamptz,
        "intentos" integer NOT NULL DEFAULT 0,
        "creada_en" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_correo_salida" PRIMARY KEY ("id"),
        CONSTRAINT "FK_correo_salida_usuario" FOREIGN KEY ("usuario_id") REFERENCES ${s}."usuario"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_correo_salida_tipo" CHECK ("tipo" IN ('ACCESO','RECUPERACION')),
        CONSTRAINT "CHK_correo_salida_intentos" CHECK ("intentos" >= 0)
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_correo_salida_pendiente" ON ${s}."correo_salida" ("expira_en") WHERE "enviado_en" IS NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaOf(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."correo_salida", ${s}."solicitud_recuperacion", ${s}."sesion_refresh_hash", ${s}."sesion_usuario", ${s}."credencial_usuario", ${s}."usuario" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(`SELECT (SELECT COUNT(*) FROM ${s}."correo_salida") + (SELECT COUNT(*) FROM ${s}."solicitud_recuperacion") + (SELECT COUNT(*) FROM ${s}."sesion_refresh_hash") + (SELECT COUNT(*) FROM ${s}."sesion_usuario") + (SELECT COUNT(*) FROM ${s}."credencial_usuario") AS total`) as Array<{ total: string }>;
    if (Number(rows[0]?.total ?? 0) > 0) throw new Error('No se puede revertir autenticación: existen credenciales, sesiones o mensajes históricos.');
    const nullSubjects = await queryRunner.query(`SELECT COUNT(*)::int AS total FROM ${s}."usuario" WHERE "id_externo_sso" IS NULL`) as Array<{ total: number }>;
    if (Number(nullSubjects[0]?.total ?? 0) > 0) throw new Error('No se puede revertir autenticación: existen cuentas creadas sin identificador SSO histórico.');
    await queryRunner.query(`DROP TABLE ${s}."correo_salida"`);
    await queryRunner.query(`DROP TABLE ${s}."solicitud_recuperacion"`);
    await queryRunner.query(`DROP TABLE ${s}."sesion_refresh_hash"`);
    await queryRunner.query(`DROP INDEX ${s}."IDX_sesion_usuario_usuario"`);
    await queryRunner.query(`DROP TABLE ${s}."sesion_usuario"`);
    await queryRunner.query(`DROP TABLE ${s}."credencial_usuario"`);
    await queryRunner.query(`ALTER TABLE ${s}."usuario" DROP CONSTRAINT "CHK_usuario_id_externo_sso_no_vacio"`);
    await queryRunner.query(`ALTER TABLE ${s}."usuario" ALTER COLUMN "id_externo_sso" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE ${s}."usuario" ADD CONSTRAINT "CHK_usuario_id_externo_sso_no_vacio" CHECK (length(btrim("id_externo_sso")) > 0)`);
  }
}
