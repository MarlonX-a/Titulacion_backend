import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schema(queryRunner: QueryRunner): string {
  const name = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error('El esquema configurado para plantillas PAT no es válido.');
  return `"${name}"`;
}

export class CreatePlantillasPat20261009100000 implements MigrationInterface {
  name = 'CreatePlantillasPat20261009100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schema(queryRunner);
    await queryRunner.query(`CREATE TABLE ${s}."plantilla_pat" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "periodo_id" uuid NOT NULL,
      "version" varchar(20) NOT NULL,
      "nombre_archivo" varchar(200) NOT NULL,
      "ruta_almacenamiento" varchar(500) NOT NULL,
      "mime_type" varchar(100) NOT NULL,
      "tamano_bytes" bigint NOT NULL,
      "hash_sha256" char(64) NOT NULL,
      "fecha_vigencia_inicio" date NOT NULL,
      "fecha_vigencia_fin" date NULL,
      "publicada_por_id" uuid NOT NULL,
      "activa" boolean NOT NULL DEFAULT true,
      CONSTRAINT "PK_plantilla_pat" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_plantilla_pat_periodo_version" UNIQUE ("periodo_id","version"),
      CONSTRAINT "FK_plantilla_pat_periodo" FOREIGN KEY ("periodo_id") REFERENCES ${s}."periodo_titulacion"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_plantilla_pat_publicada_por" FOREIGN KEY ("publicada_por_id") REFERENCES ${s}."usuario"("id") ON DELETE RESTRICT,
      CONSTRAINT "CHK_plantilla_pat_version_no_vacia" CHECK (length(btrim("version")) > 0),
      CONSTRAINT "CHK_plantilla_pat_nombre_no_vacio" CHECK (length(btrim("nombre_archivo")) > 0),
      CONSTRAINT "CHK_plantilla_pat_ruta_no_vacia" CHECK (length(btrim("ruta_almacenamiento")) > 0),
      CONSTRAINT "CHK_plantilla_pat_mime_no_vacio" CHECK (length(btrim("mime_type")) > 0),
      CONSTRAINT "CHK_plantilla_pat_tamano_positivo" CHECK ("tamano_bytes" > 0),
      CONSTRAINT "CHK_plantilla_pat_hash_sha256" CHECK ("hash_sha256" ~ '^[a-f0-9]{64}$'),
      CONSTRAINT "CHK_plantilla_pat_vigencia" CHECK ("fecha_vigencia_fin" IS NULL OR "fecha_vigencia_fin" >= "fecha_vigencia_inicio")
    )`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_plantilla_pat_activa_periodo" ON ${s}."plantilla_pat" ("periodo_id") WHERE "activa" = true`);
    await queryRunner.query(`CREATE INDEX "IDX_plantilla_pat_periodo_vigencia" ON ${s}."plantilla_pat" ("periodo_id","fecha_vigencia_inicio" DESC,"id" ASC)`);
    await queryRunner.query(`CREATE FUNCTION ${s}."proteger_plantilla_pat"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_estado text;
      BEGIN
        IF TG_OP='DELETE' THEN RAISE EXCEPTION 'las versiones de plantillas PAT son históricas' USING ERRCODE='23514'; END IF;
        IF TG_OP='UPDATE' THEN
          IF OLD."activa" IS NOT TRUE OR NEW."activa" IS NOT FALSE OR
             (to_jsonb(NEW)-ARRAY['activa','fecha_vigencia_fin']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['activa','fecha_vigencia_fin']) OR
             NEW."fecha_vigencia_fin" IS NULL OR NEW."fecha_vigencia_fin" < OLD."fecha_vigencia_inicio" THEN
            RAISE EXCEPTION 'una plantilla publicada solo puede pasar a inactiva al sustituirla' USING ERRCODE='23514';
          END IF;
          RETURN NEW;
        END IF;
        SELECT "estado"::text INTO v_estado FROM ${s}."periodo_titulacion" WHERE "id"=NEW."periodo_id" FOR UPDATE;
        IF NOT FOUND OR v_estado='ARCHIVADO' THEN RAISE EXCEPTION 'no se puede publicar plantilla en un período inexistente o archivado' USING ERRCODE='23514'; END IF;
        IF NEW."activa" IS NOT TRUE OR NEW."fecha_vigencia_fin" IS NOT NULL THEN RAISE EXCEPTION 'una versión nueva debe publicarse activa' USING ERRCODE='23514'; END IF;
        RETURN NEW;
      END $$`);
    await queryRunner.query(`CREATE TRIGGER "TRG_plantilla_pat_proteger" BEFORE INSERT OR UPDATE OR DELETE ON ${s}."plantilla_pat" FOR EACH ROW EXECUTE FUNCTION ${s}."proteger_plantilla_pat"()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schema(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."plantilla_pat" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(`SELECT count(*)::int AS total FROM ${s}."plantilla_pat"`) as Array<{ total: number }>;
    if (Number(rows[0]?.total ?? 0) > 0) throw new Error('No se puede revertir la migración: existen versiones de plantillas PAT.');
    await queryRunner.query(`DROP TRIGGER "TRG_plantilla_pat_proteger" ON ${s}."plantilla_pat"`);
    await queryRunner.query(`DROP FUNCTION ${s}."proteger_plantilla_pat"()`);
    await queryRunner.query(`DROP TABLE ${s}."plantilla_pat"`);
  }
}
