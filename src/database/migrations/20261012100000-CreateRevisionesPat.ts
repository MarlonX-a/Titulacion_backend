import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schema(queryRunner: QueryRunner): string {
  const name = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error('El esquema configurado para revisiones PAT no es válido.');
  return `"${name}"`;
}

export class CreateRevisionesPat20261012100000 implements MigrationInterface {
  name = 'CreateRevisionesPat20261012100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schema(queryRunner);
    await queryRunner.query(`CREATE TYPE ${s}."revision_pat_resultado_enum" AS ENUM ('APROBADO','OBSERVADO','RECHAZADO')`);
    await queryRunner.query(`CREATE TABLE ${s}."revision_pat" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "documento_pat_id" uuid NOT NULL,
      "revisor_id" uuid NOT NULL,
      "resultado" ${s}."revision_pat_resultado_enum" NOT NULL,
      "observaciones" text NULL,
      "fecha_revision" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PK_revision_pat" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_revision_pat_documento" UNIQUE ("documento_pat_id"),
      CONSTRAINT "FK_revision_pat_documento" FOREIGN KEY ("documento_pat_id") REFERENCES ${s}."documento_pat"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_revision_pat_revisor" FOREIGN KEY ("revisor_id") REFERENCES ${s}."usuario"("id") ON DELETE RESTRICT,
      CONSTRAINT "CHK_revision_pat_observaciones" CHECK ("resultado"='APROBADO' OR ("observaciones" IS NOT NULL AND length(btrim("observaciones")) > 0))
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_revision_pat_revisor_fecha" ON ${s}."revision_pat" ("revisor_id","fecha_revision" DESC)`);
    await queryRunner.query(`CREATE OR REPLACE FUNCTION ${s}."proteger_documento_pat"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_periodo_asignacion uuid; v_estado_asignacion text; v_periodo_plantilla uuid; v_activa boolean; v_periodo_estado text; v_ultima_version smallint; v_ultima_revision text;
      BEGIN
        IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'los documentos PAT son históricos e inmutables' USING ERRCODE='23514'; END IF;
        SELECT a."periodo_id" INTO v_periodo_asignacion FROM ${s}."asignacion_tema" a WHERE a."id"=NEW."asignacion_tema_id";
        IF v_periodo_asignacion IS NULL THEN RAISE EXCEPTION 'la asignación de tema no existe' USING ERRCODE='23514'; END IF;
        SELECT "estado"::text INTO v_periodo_estado FROM ${s}."periodo_titulacion" WHERE "id"=v_periodo_asignacion FOR UPDATE;
        SELECT a."estado"::text INTO v_estado_asignacion FROM ${s}."asignacion_tema" a WHERE a."id"=NEW."asignacion_tema_id" FOR UPDATE;
        SELECT p."periodo_id", p."activa" INTO v_periodo_plantilla, v_activa FROM ${s}."plantilla_pat" p WHERE p."id"=NEW."plantilla_id" FOR UPDATE;
        IF v_periodo_plantilla IS NULL OR v_periodo_asignacion <> v_periodo_plantilla OR v_activa IS NOT TRUE OR v_estado_asignacion <> 'VIGENTE' OR v_periodo_estado NOT IN ('POSTULACION_CERRADA','EN_CURSO') THEN
          RAISE EXCEPTION 'el documento requiere asignación vigente, plantilla activa del mismo período y período habilitado' USING ERRCODE='23514';
        END IF;
        SELECT d."version", r."resultado"::text INTO v_ultima_version, v_ultima_revision
          FROM ${s}."documento_pat" d LEFT JOIN ${s}."revision_pat" r ON r."documento_pat_id"=d."id"
          WHERE d."asignacion_tema_id"=NEW."asignacion_tema_id" ORDER BY d."version" DESC LIMIT 1;
        IF v_ultima_version IS NOT NULL AND (v_ultima_revision IS NULL OR v_ultima_revision NOT IN ('OBSERVADO','RECHAZADO')) THEN
          RAISE EXCEPTION 'la última versión PAT debe estar observada o rechazada antes de una corrección' USING ERRCODE='23514';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM ${s}."archivo_limpieza_pendiente" f WHERE f."ruta_almacenamiento"=NEW."ruta_almacenamiento") THEN
          RAISE EXCEPTION 'el archivo debe tener intención de carga registrada' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$`);
    await queryRunner.query(`CREATE FUNCTION ${s}."proteger_revision_pat"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_periodo_id uuid; v_periodo_estado text; v_asignacion_estado text; v_rol text; v_usuario_estado text;
      BEGIN
        IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'las revisiones PAT son históricas e inmutables' USING ERRCODE='23514'; END IF;
        SELECT a."periodo_id" INTO v_periodo_id FROM ${s}."asignacion_tema" a JOIN ${s}."documento_pat" d ON d."asignacion_tema_id"=a."id" WHERE d."id"=NEW."documento_pat_id";
        IF v_periodo_id IS NULL THEN RAISE EXCEPTION 'el documento PAT no existe' USING ERRCODE='23514'; END IF;
        SELECT "estado"::text INTO v_periodo_estado FROM ${s}."periodo_titulacion" WHERE "id"=v_periodo_id FOR UPDATE;
        SELECT a."estado"::text INTO v_asignacion_estado FROM ${s}."asignacion_tema" a JOIN ${s}."documento_pat" d ON d."asignacion_tema_id"=a."id" WHERE d."id"=NEW."documento_pat_id" FOR UPDATE OF a;
        PERFORM 1 FROM ${s}."documento_pat" WHERE "id"=NEW."documento_pat_id" FOR UPDATE;
        SELECT "rol"::text, "estado"::text INTO v_rol, v_usuario_estado FROM ${s}."usuario" WHERE "id"=NEW."revisor_id" FOR KEY SHARE;
        IF v_rol <> 'ADMIN' OR v_usuario_estado <> 'ACTIVO' OR v_periodo_estado NOT IN ('POSTULACION_CERRADA','EN_CURSO') OR v_asignacion_estado <> 'VIGENTE' THEN
          RAISE EXCEPTION 'la revisión requiere ADMIN activo, período habilitado y asignación vigente' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$`);
    await queryRunner.query(`CREATE TRIGGER "TRG_revision_pat_proteger" BEFORE INSERT OR UPDATE OR DELETE ON ${s}."revision_pat" FOR EACH ROW EXECUTE FUNCTION ${s}."proteger_revision_pat"()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schema(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."revision_pat" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(`SELECT count(*)::int AS total FROM ${s}."revision_pat"`) as Array<{ total: number }>;
    if (Number(rows[0]?.total ?? 0) > 0) throw new Error('No se puede revertir: existen revisiones PAT históricas.');
    await queryRunner.query(`DROP TRIGGER "TRG_revision_pat_proteger" ON ${s}."revision_pat"`);
    await queryRunner.query(`DROP FUNCTION ${s}."proteger_revision_pat"()`);
    await queryRunner.query(`DROP TABLE ${s}."revision_pat"`);
    await queryRunner.query(`DROP TYPE ${s}."revision_pat_resultado_enum"`);
    await queryRunner.query(`CREATE OR REPLACE FUNCTION ${s}."proteger_documento_pat"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_periodo_asignacion uuid; v_estado_asignacion text; v_periodo_plantilla uuid; v_activa boolean; v_periodo_estado text;
      BEGIN
        IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'los documentos PAT son históricos e inmutables' USING ERRCODE='23514'; END IF;
        SELECT a."periodo_id", a."estado"::text INTO v_periodo_asignacion, v_estado_asignacion FROM ${s}."asignacion_tema" a WHERE a."id"=NEW."asignacion_tema_id" FOR UPDATE;
        SELECT p."periodo_id", p."activa" INTO v_periodo_plantilla, v_activa FROM ${s}."plantilla_pat" p WHERE p."id"=NEW."plantilla_id" FOR UPDATE;
        SELECT "estado"::text INTO v_periodo_estado FROM ${s}."periodo_titulacion" WHERE "id"=v_periodo_asignacion FOR UPDATE;
        IF v_periodo_asignacion IS NULL OR v_periodo_plantilla IS NULL OR v_periodo_asignacion <> v_periodo_plantilla OR v_activa IS NOT TRUE OR v_estado_asignacion <> 'VIGENTE' OR v_periodo_estado NOT IN ('POSTULACION_CERRADA','EN_CURSO') THEN
          RAISE EXCEPTION 'el documento requiere asignación vigente, plantilla activa del mismo período y período habilitado' USING ERRCODE='23514';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM ${s}."archivo_limpieza_pendiente" f WHERE f."ruta_almacenamiento"=NEW."ruta_almacenamiento") THEN
          RAISE EXCEPTION 'el archivo debe tener intención de carga registrada' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$`);
  }
}
