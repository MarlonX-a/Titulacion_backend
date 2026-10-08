import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schema(queryRunner: QueryRunner): string {
  const name = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error('El esquema configurado para notificaciones no es válido.');
  return `"${name}"`;
}

export class CreateNotificaciones20261013100000 implements MigrationInterface {
  name = 'CreateNotificaciones20261013100000';
  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schema(queryRunner);
    await queryRunner.query(`CREATE TYPE ${s}."notificacion_canal_enum" AS ENUM ('EN_APP','EMAIL')`);
    await queryRunner.query(`CREATE TYPE ${s}."entrega_correo_estado_enum" AS ENUM ('PENDIENTE','PROCESANDO','ENVIADO','FALLIDO','OMITIDO')`);
    await queryRunner.query(`CREATE TABLE ${s}."notificacion" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(), "usuario_id" uuid NOT NULL, "tipo" varchar(60) NOT NULL,
      "titulo" varchar(200) NOT NULL, "mensaje" text NOT NULL, "entidad_tipo" varchar(60) NOT NULL, "entidad_id" uuid NOT NULL,
      "canal" ${s}."notificacion_canal_enum" NOT NULL, "leida" boolean NOT NULL DEFAULT false,
      "fecha_creacion" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, "fecha_envio" timestamptz,
      CONSTRAINT "PK_notificacion" PRIMARY KEY ("id"),
      CONSTRAINT "FK_notificacion_usuario" FOREIGN KEY ("usuario_id") REFERENCES ${s}."usuario"("id") ON DELETE RESTRICT,
      CONSTRAINT "UQ_notificacion_destinatario_evento_canal" UNIQUE ("usuario_id","tipo","entidad_tipo","entidad_id","canal"),
      CONSTRAINT "CHK_notificacion_tipo_pat" CHECK ("tipo" IN ('PAT_ENTREGADO','PAT_REVISADO')),
      CONSTRAINT "CHK_notificacion_entidad_pat" CHECK (("tipo"='PAT_ENTREGADO' AND "entidad_tipo"='documento_pat') OR ("tipo"='PAT_REVISADO' AND "entidad_tipo"='revision_pat')),
      CONSTRAINT "CHK_notificacion_texto" CHECK (length(btrim("titulo")) > 0 AND length(btrim("mensaje")) > 0),
      CONSTRAINT "CHK_notificacion_envio_app" CHECK ("canal" <> 'EN_APP' OR "fecha_envio" IS NOT NULL),
      CONSTRAINT "CHK_notificacion_email_no_leida" CHECK ("canal" <> 'EMAIL' OR "leida"=false)
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_notificacion_bandeja" ON ${s}."notificacion" ("usuario_id","canal","fecha_creacion" DESC,"id")`);
    await queryRunner.query(`CREATE INDEX "IDX_notificacion_no_leidas" ON ${s}."notificacion" ("usuario_id","fecha_creacion" DESC) WHERE "canal"='EN_APP' AND "leida"=false`);
    await queryRunner.query(`CREATE TABLE ${s}."entrega_correo_notificacion" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(), "notificacion_id" uuid NOT NULL, "estado" ${s}."entrega_correo_estado_enum" NOT NULL DEFAULT 'PENDIENTE',
      "intentos" integer NOT NULL DEFAULT 0, "creada_en" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "actualizada_en" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, "reserva_hasta" timestamptz, "ultimo_error" text, "enviada_en" timestamptz,
      CONSTRAINT "PK_entrega_correo_notificacion" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_entrega_correo_notificacion" UNIQUE ("notificacion_id"),
      CONSTRAINT "FK_entrega_correo_notificacion_notificacion" FOREIGN KEY ("notificacion_id") REFERENCES ${s}."notificacion"("id") ON DELETE RESTRICT,
      CONSTRAINT "CHK_entrega_correo_notificacion_intentos" CHECK ("intentos" >= 0),
      CONSTRAINT "CHK_entrega_correo_notificacion_estado" CHECK (("estado"='PROCESANDO') = ("reserva_hasta" IS NOT NULL) AND (("estado"='ENVIADO') = ("enviada_en" IS NOT NULL)))
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_entrega_correo_notificacion_pendiente" ON ${s}."entrega_correo_notificacion" ("estado","creada_en") WHERE "estado" IN ('PENDIENTE','FALLIDO','PROCESANDO')`);
    await queryRunner.query(`CREATE FUNCTION ${s}."proteger_notificacion"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='DELETE' THEN RAISE EXCEPTION 'las notificaciones son históricas' USING ERRCODE='23514'; END IF;
        IF OLD."usuario_id" IS DISTINCT FROM NEW."usuario_id" OR OLD."tipo" IS DISTINCT FROM NEW."tipo" OR OLD."titulo" IS DISTINCT FROM NEW."titulo" OR OLD."mensaje" IS DISTINCT FROM NEW."mensaje" OR OLD."entidad_tipo" IS DISTINCT FROM NEW."entidad_tipo" OR OLD."entidad_id" IS DISTINCT FROM NEW."entidad_id" OR OLD."canal" IS DISTINCT FROM NEW."canal" OR OLD."fecha_creacion" IS DISTINCT FROM NEW."fecha_creacion" THEN
          RAISE EXCEPTION 'el contenido de una notificación es inmutable' USING ERRCODE='23514';
        END IF;
        IF OLD."canal"='EN_APP' THEN
          IF (OLD."leida" AND NOT NEW."leida") OR NEW."fecha_envio" IS DISTINCT FROM OLD."fecha_envio" THEN RAISE EXCEPTION 'solo se permite marcar la notificación como leída' USING ERRCODE='23514'; END IF;
        ELSIF NEW."leida" IS DISTINCT FROM OLD."leida" OR (OLD."fecha_envio" IS NOT NULL AND NEW."fecha_envio" IS DISTINCT FROM OLD."fecha_envio") THEN
          RAISE EXCEPTION 'el correo de notificación conserva su estado histórico' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$`);
    await queryRunner.query(`CREATE TRIGGER "TRG_notificacion_proteger" BEFORE UPDATE OR DELETE ON ${s}."notificacion" FOR EACH ROW EXECUTE FUNCTION ${s}."proteger_notificacion"()`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schema(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."entrega_correo_notificacion", ${s}."notificacion" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(`SELECT (SELECT count(*) FROM ${s}."notificacion") + (SELECT count(*) FROM ${s}."entrega_correo_notificacion") AS total`) as Array<{ total: number | string }>;
    if (Number(rows[0]?.total ?? 0) > 0) throw new Error('No se puede revertir: existen notificaciones o solicitudes de correo históricas.');
    await queryRunner.query(`DROP TABLE ${s}."entrega_correo_notificacion"`);
    await queryRunner.query(`DROP TRIGGER "TRG_notificacion_proteger" ON ${s}."notificacion"`);
    await queryRunner.query(`DROP FUNCTION ${s}."proteger_notificacion"()`);
    await queryRunner.query(`DROP TABLE ${s}."notificacion"`);
    await queryRunner.query(`DROP TYPE ${s}."entrega_correo_estado_enum"`);
    await queryRunner.query(`DROP TYPE ${s}."notificacion_canal_enum"`);
  }
}
