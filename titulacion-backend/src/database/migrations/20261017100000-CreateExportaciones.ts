import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schema(queryRunner: QueryRunner): string {
  const value = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('El esquema configurado para exportaciones no es válido.');
  return `"${value}"`;
}

function resultRows<T>(value: unknown): T[] {
  if (Array.isArray(value) && Array.isArray(value[0]) && typeof value[1] === 'number') return value[0] as T[];
  return value as T[];
}

export class CreateExportaciones20261017100000 implements MigrationInterface {
  name = 'CreateExportaciones20261017100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schema(queryRunner);
    await queryRunner.query(`CREATE TYPE ${s}."solicitud_exportacion_tipo_enum" AS ENUM ('ESTUDIANTES','GRUPOS','TEMAS_OFERTADOS','TEMAS_ASIGNADOS','TEMAS_DISPONIBLES','DOCENTES','CARGA_TUTORIAL')`);
    await queryRunner.query(`CREATE TYPE ${s}."solicitud_exportacion_formato_enum" AS ENUM ('PDF','XLSX','CSV')`);
    await queryRunner.query(`CREATE TYPE ${s}."solicitud_exportacion_estado_enum" AS ENUM ('EN_COLA','PROCESANDO','LISTO','FALLIDO')`);
    await queryRunner.query(`CREATE TABLE ${s}."solicitud_exportacion" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "periodo_id" uuid NOT NULL,
      "solicitante_id" uuid NOT NULL,
      "tipo_reporte" ${s}."solicitud_exportacion_tipo_enum" NOT NULL,
      "formato" ${s}."solicitud_exportacion_formato_enum" NOT NULL,
      "filtros" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "estado" ${s}."solicitud_exportacion_estado_enum" NOT NULL DEFAULT 'EN_COLA',
      "ruta_almacenamiento" varchar(500),
      "tamano_bytes" bigint,
      "hash_sha256" char(64),
      "archivo_limpiado" boolean NOT NULL DEFAULT false,
      "expira_en" timestamptz,
      "fecha_solicitud" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "fecha_generacion" timestamptz,
      "ciclo" integer NOT NULL DEFAULT 1,
      "intentos" smallint NOT NULL DEFAULT 0,
      "proxima_ejecucion" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "reserva_id" uuid,
      "reserva_expira_en" timestamptz,
      "error_sanitizado" varchar(300),
      CONSTRAINT "PK_solicitud_exportacion" PRIMARY KEY ("id"),
      CONSTRAINT "FK_solicitud_exportacion_periodo" FOREIGN KEY ("periodo_id") REFERENCES ${s}."periodo_titulacion"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_solicitud_exportacion_solicitante" FOREIGN KEY ("solicitante_id") REFERENCES ${s}."usuario"("id") ON DELETE RESTRICT,
      CONSTRAINT "CHK_solicitud_exportacion_filtros_objeto" CHECK (jsonb_typeof("filtros") = 'object'),
      CONSTRAINT "CHK_solicitud_exportacion_tamano" CHECK ("tamano_bytes" IS NULL OR "tamano_bytes" > 0),
      CONSTRAINT "CHK_solicitud_exportacion_hash" CHECK ("hash_sha256" IS NULL OR "hash_sha256" ~ '^[a-f0-9]{64}$'),
      CONSTRAINT "CHK_solicitud_exportacion_fechas" CHECK ("fecha_generacion" IS NULL OR "fecha_generacion" >= "fecha_solicitud"),
      CONSTRAINT "CHK_solicitud_exportacion_listo" CHECK ("estado" <> 'LISTO' OR (length(btrim("ruta_almacenamiento")) > 0 AND "tamano_bytes" > 0 AND "hash_sha256" IS NOT NULL AND "fecha_generacion" IS NOT NULL AND "expira_en" IS NOT NULL)),
      CONSTRAINT "CHK_solicitud_exportacion_reserva" CHECK (("estado" = 'PROCESANDO') = ("reserva_id" IS NOT NULL AND "reserva_expira_en" IS NOT NULL)),
      CONSTRAINT "CHK_solicitud_exportacion_intentos" CHECK ("ciclo" >= 1 AND "intentos" >= 0)
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_solicitud_exportacion_usuario_fecha" ON ${s}."solicitud_exportacion" ("solicitante_id","fecha_solicitud" DESC,"id" ASC)`);
    await queryRunner.query(`CREATE INDEX "IDX_solicitud_exportacion_periodo" ON ${s}."solicitud_exportacion" ("periodo_id","fecha_solicitud" DESC,"id" ASC)`);
    await queryRunner.query(`CREATE INDEX "IDX_solicitud_exportacion_estado_proxima" ON ${s}."solicitud_exportacion" ("estado","proxima_ejecucion","fecha_solicitud")`);
    await queryRunner.query(`CREATE FUNCTION ${s}."proteger_solicitud_exportacion"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='DELETE' THEN RAISE EXCEPTION 'las solicitudes de exportación son históricas' USING ERRCODE='23514'; END IF;
        IF TG_OP='UPDATE' THEN
          IF (to_jsonb(NEW)-ARRAY['estado','ruta_almacenamiento','tamano_bytes','hash_sha256','expira_en','fecha_generacion','ciclo','intentos','proxima_ejecucion','reserva_id','reserva_expira_en','error_sanitizado']) IS DISTINCT FROM
             (to_jsonb(OLD)-ARRAY['estado','ruta_almacenamiento','tamano_bytes','hash_sha256','expira_en','fecha_generacion','ciclo','intentos','proxima_ejecucion','reserva_id','reserva_expira_en','error_sanitizado']) THEN
            RAISE EXCEPTION 'los parámetros originales de exportación son inmutables' USING ERRCODE='23514';
          END IF;
          IF OLD."estado"='LISTO' AND (to_jsonb(NEW)-ARRAY['estado','archivo_limpiado']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['estado','archivo_limpiado']) THEN
            RAISE EXCEPTION 'un archivo generado es inmutable' USING ERRCODE='23514';
          END IF;
          IF OLD."estado"='LISTO' AND NEW."estado"='LISTO' AND OLD."archivo_limpiado" IS DISTINCT FROM NEW."archivo_limpiado"
             AND NOT (OLD."archivo_limpiado"=false AND NEW."archivo_limpiado"=true) THEN
            RAISE EXCEPTION 'la limpieza solo puede marcarse una vez' USING ERRCODE='23514';
          END IF;
          IF NOT ((OLD."estado"='EN_COLA' AND NEW."estado"='PROCESANDO') OR
                  (OLD."estado"='PROCESANDO' AND NEW."estado" IN ('EN_COLA','LISTO','FALLIDO')) OR
                  (OLD."estado"='FALLIDO' AND NEW."estado"='EN_COLA' AND NEW."ciclo"=OLD."ciclo"+1) OR
                  (OLD."estado"='LISTO' AND NEW."estado"='LISTO' AND OLD."archivo_limpiado"=false AND NEW."archivo_limpiado"=true) OR
                  (OLD."estado"=NEW."estado" AND OLD."estado" IN ('EN_COLA','PROCESANDO','FALLIDO'))) THEN
            RAISE EXCEPTION 'transición de exportación no permitida' USING ERRCODE='23514';
          END IF;
        END IF;
        RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
      END $$`);
    await queryRunner.query(`CREATE TRIGGER "TRG_solicitud_exportacion_proteger" BEFORE INSERT OR UPDATE OR DELETE ON ${s}."solicitud_exportacion" FOR EACH ROW EXECUTE FUNCTION ${s}."proteger_solicitud_exportacion"()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schema(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."solicitud_exportacion" IN ACCESS EXCLUSIVE MODE`);
    await queryRunner.query(`LOCK TABLE ${s}."archivo_limpieza_pendiente" IN SHARE MODE`);
    const rows = resultRows<{ total: number }>(await queryRunner.query(`SELECT count(*)::int AS total FROM ${s}."solicitud_exportacion"`));
    if (Number(rows[0]?.total ?? 0) > 0) throw new Error('No se puede revertir exportaciones: existen solicitudes históricas.');
    const pending = resultRows<{ total: number }>(await queryRunner.query(`SELECT count(*)::int AS total FROM ${s}."archivo_limpieza_pendiente" WHERE "ruta_almacenamiento" LIKE 'exportaciones/%'`));
    if (Number(pending[0]?.total ?? 0) > 0) throw new Error('No se puede revertir exportaciones: existen archivos pendientes de limpieza.');
    await queryRunner.query(`DROP TRIGGER "TRG_solicitud_exportacion_proteger" ON ${s}."solicitud_exportacion"`);
    await queryRunner.query(`DROP FUNCTION ${s}."proteger_solicitud_exportacion"()`);
    await queryRunner.query(`DROP TABLE ${s}."solicitud_exportacion"`);
    await queryRunner.query(`DROP TYPE ${s}."solicitud_exportacion_estado_enum"`);
    await queryRunner.query(`DROP TYPE ${s}."solicitud_exportacion_formato_enum"`);
    await queryRunner.query(`DROP TYPE ${s}."solicitud_exportacion_tipo_enum"`);
  }
}
