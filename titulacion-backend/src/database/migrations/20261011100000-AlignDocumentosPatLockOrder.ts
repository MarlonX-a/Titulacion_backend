import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schema(queryRunner: QueryRunner): string {
  const name = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error('El esquema configurado para documentos PAT no es válido.');
  return `"${name}"`;
}

export class AlignDocumentosPatLockOrder20261011100000 implements MigrationInterface {
  name = 'AlignDocumentosPatLockOrder20261011100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schema(queryRunner);
    await queryRunner.query(`ALTER TABLE ${s}."archivo_limpieza_pendiente" ADD COLUMN "periodo_id" uuid NULL`);
    await queryRunner.query(`UPDATE ${s}."archivo_limpieza_pendiente" f SET "periodo_id"=p."periodo_id" FROM ${s}."plantilla_pat" p WHERE f."ruta_almacenamiento"=p."ruta_almacenamiento" AND f."periodo_id" IS NULL`);
    await queryRunner.query(`UPDATE ${s}."archivo_limpieza_pendiente" f SET "periodo_id"=a."periodo_id" FROM ${s}."documento_pat" d JOIN ${s}."asignacion_tema" a ON a."id"=d."asignacion_tema_id" WHERE f."ruta_almacenamiento"=d."ruta_almacenamiento" AND f."periodo_id" IS NULL`);
    await queryRunner.query(`ALTER TABLE ${s}."archivo_limpieza_pendiente" ADD CONSTRAINT "FK_archivo_limpieza_periodo" FOREIGN KEY ("periodo_id") REFERENCES ${s}."periodo_titulacion"("id") ON DELETE RESTRICT`);
    await queryRunner.query(`CREATE INDEX "IDX_archivo_limpieza_periodo_estado" ON ${s}."archivo_limpieza_pendiente" ("periodo_id","estado","creado_en")`);
    await queryRunner.query(`CREATE OR REPLACE FUNCTION ${s}."proteger_documento_pat"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_periodo_asignacion uuid; v_estado_asignacion text; v_periodo_plantilla uuid; v_activa boolean; v_periodo_estado text;
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
        IF NOT EXISTS (SELECT 1 FROM ${s}."archivo_limpieza_pendiente" f WHERE f."ruta_almacenamiento"=NEW."ruta_almacenamiento") THEN
          RAISE EXCEPTION 'el archivo debe tener intención de carga registrada' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schema(queryRunner);
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
    await queryRunner.query(`DROP INDEX ${s}."IDX_archivo_limpieza_periodo_estado"`);
    await queryRunner.query(`ALTER TABLE ${s}."archivo_limpieza_pendiente" DROP CONSTRAINT "FK_archivo_limpieza_periodo", DROP COLUMN "periodo_id"`);
  }
}
