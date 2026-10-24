import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schema(queryRunner: QueryRunner): string {
  const name = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error('El esquema configurado para documentos PAT no es válido.');
  return `"${name}"`;
}

export class CreateDocumentosPat20261010100000 implements MigrationInterface {
  name = 'CreateDocumentosPat20261010100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schema(queryRunner);
    await queryRunner.query(`CREATE TABLE ${s}."archivo_limpieza_pendiente" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "ruta_almacenamiento" varchar(500) NOT NULL,
      "estado" varchar(20) NOT NULL DEFAULT 'SUBIENDO',
      "creado_en" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PK_archivo_limpieza_pendiente" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_archivo_limpieza_ruta" UNIQUE ("ruta_almacenamiento"),
      CONSTRAINT "CHK_archivo_limpieza_estado" CHECK ("estado" IN ('SUBIENDO','LIMPIEZA')),
      CONSTRAINT "CHK_archivo_limpieza_ruta_privada" CHECK ("ruta_almacenamiento" LIKE 'plantillas-pat/%' OR "ruta_almacenamiento" LIKE 'documentos-pat/%')
    )`);
    await queryRunner.query(`CREATE TYPE ${s}."documento_pat_formato_enum" AS ENUM ('PDF','DOCX')`);
    await queryRunner.query(`CREATE TABLE ${s}."documento_pat" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "asignacion_tema_id" uuid NOT NULL,
      "plantilla_id" uuid NOT NULL,
      "version" smallint NOT NULL,
      "nombre_archivo" varchar(200) NOT NULL,
      "ruta_almacenamiento" varchar(500) NOT NULL,
      "formato" ${s}."documento_pat_formato_enum" NOT NULL,
      "tamano_bytes" bigint NOT NULL,
      "hash_sha256" char(64) NOT NULL,
      "cargado_por_id" uuid NOT NULL,
      "fecha_carga" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PK_documento_pat" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_documento_pat_asignacion_version" UNIQUE ("asignacion_tema_id","version"),
      CONSTRAINT "FK_documento_pat_asignacion" FOREIGN KEY ("asignacion_tema_id") REFERENCES ${s}."asignacion_tema"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_documento_pat_plantilla" FOREIGN KEY ("plantilla_id") REFERENCES ${s}."plantilla_pat"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_documento_pat_cargador" FOREIGN KEY ("cargado_por_id") REFERENCES ${s}."usuario"("id") ON DELETE RESTRICT,
      CONSTRAINT "CHK_documento_pat_version" CHECK ("version" >= 1),
      CONSTRAINT "CHK_documento_pat_nombre_no_vacio" CHECK (length(btrim("nombre_archivo")) > 0),
      CONSTRAINT "CHK_documento_pat_ruta_no_vacia" CHECK (length(btrim("ruta_almacenamiento")) > 0),
      CONSTRAINT "CHK_documento_pat_tamano_positivo" CHECK ("tamano_bytes" > 0),
      CONSTRAINT "CHK_documento_pat_hash_sha256" CHECK ("hash_sha256" ~ '^[a-f0-9]{64}$')
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_documento_pat_asignacion_version" ON ${s}."documento_pat" ("asignacion_tema_id","version" DESC,"id" ASC)`);
    await queryRunner.query(`CREATE FUNCTION ${s}."proteger_documento_pat"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_periodo_asignacion uuid; v_estado_asignacion text; v_periodo_plantilla uuid; v_activa boolean; v_periodo_estado text;
      BEGIN
        IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'los documentos PAT son históricos e inmutables' USING ERRCODE='23514'; END IF;
        SELECT a."periodo_id", a."estado"::text INTO v_periodo_asignacion, v_estado_asignacion
          FROM ${s}."asignacion_tema" a WHERE a."id"=NEW."asignacion_tema_id" FOR UPDATE;
        SELECT p."periodo_id", p."activa" INTO v_periodo_plantilla, v_activa
          FROM ${s}."plantilla_pat" p WHERE p."id"=NEW."plantilla_id" FOR UPDATE;
        SELECT "estado"::text INTO v_periodo_estado FROM ${s}."periodo_titulacion" WHERE "id"=v_periodo_asignacion FOR UPDATE;
        IF v_periodo_asignacion IS NULL OR v_periodo_plantilla IS NULL OR v_periodo_asignacion <> v_periodo_plantilla OR v_activa IS NOT TRUE OR v_estado_asignacion <> 'VIGENTE' OR v_periodo_estado NOT IN ('POSTULACION_CERRADA','EN_CURSO') THEN
          RAISE EXCEPTION 'el documento requiere asignación vigente, plantilla activa del mismo período y período habilitado' USING ERRCODE='23514';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM ${s}."archivo_limpieza_pendiente" f WHERE f."ruta_almacenamiento"=NEW."ruta_almacenamiento") THEN
          RAISE EXCEPTION 'el archivo debe tener intención de carga registrada' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$`);
    await queryRunner.query(`CREATE TRIGGER "TRG_documento_pat_proteger" BEFORE INSERT OR UPDATE OR DELETE ON ${s}."documento_pat" FOR EACH ROW EXECUTE FUNCTION ${s}."proteger_documento_pat"()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schema(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."documento_pat", ${s}."archivo_limpieza_pendiente" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(`SELECT (SELECT count(*) FROM ${s}."documento_pat")::int AS documentos, (SELECT count(*) FROM ${s}."archivo_limpieza_pendiente")::int AS pendientes`) as Array<{ documentos: number; pendientes: number }>;
    if (Number(rows[0]?.documentos ?? 0) > 0 || Number(rows[0]?.pendientes ?? 0) > 0) throw new Error('No se puede revertir: existen documentos PAT o cargas pendientes.');
    await queryRunner.query(`DROP TRIGGER "TRG_documento_pat_proteger" ON ${s}."documento_pat"`);
    await queryRunner.query(`DROP FUNCTION ${s}."proteger_documento_pat"()`);
    await queryRunner.query(`DROP TABLE ${s}."documento_pat"`);
    await queryRunner.query(`DROP TYPE ${s}."documento_pat_formato_enum"`);
    await queryRunner.query(`DROP TABLE ${s}."archivo_limpieza_pendiente"`);
  }
}
