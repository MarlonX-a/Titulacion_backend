import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaOf(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema configurado no es válido.');
  return `"${schema}"`;
}

export class CreateImportPreparation20261006110000 implements MigrationInterface {
  name = 'CreateImportPreparation20261006110000';
  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaOf(queryRunner);
    await queryRunner.query(`CREATE TABLE ${s}."preparacion_importacion" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "periodo_id" uuid NOT NULL,
      "solicitada_por_id" uuid NOT NULL,
      "lote_id" uuid,
      "nombre_archivo" varchar(200) NOT NULL,
      "ruta_almacenamiento" varchar(500) NOT NULL,
      "sha256" char(64) NOT NULL,
      "estado" varchar(24) NOT NULL,
      "ip_origen" inet,
      "total_filas" integer NOT NULL DEFAULT 0,
      "filas" jsonb,
      "errores" jsonb,
      "creada_en" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "expira_en" timestamptz NOT NULL,
      CONSTRAINT "PK_preparacion_importacion" PRIMARY KEY ("id"),
      CONSTRAINT "FK_preparacion_importacion_periodo" FOREIGN KEY ("periodo_id") REFERENCES ${s}."periodo_titulacion"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_preparacion_importacion_usuario" FOREIGN KEY ("solicitada_por_id") REFERENCES ${s}."usuario"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_preparacion_importacion_lote" FOREIGN KEY ("lote_id") REFERENCES ${s}."lote_importacion"("id") ON DELETE RESTRICT,
      CONSTRAINT "CHK_preparacion_importacion_estado" CHECK ("estado" IN ('VALIDANDO','LISTA','INVALIDA','EN_COLA','PROCESANDO','COMPLETADA','FALLIDA')),
      CONSTRAINT "CHK_preparacion_importacion_filas" CHECK ("total_filas" >= 0),
      CONSTRAINT "CHK_preparacion_importacion_archivo" CHECK (length(btrim("nombre_archivo")) > 0 AND length(btrim("ruta_almacenamiento")) > 0)
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_preparacion_importacion_lote" ON ${s}."preparacion_importacion" ("solicitada_por_id", "creada_en" DESC)`);
    await queryRunner.query(`CREATE INDEX "IDX_preparacion_importacion_pendiente" ON ${s}."preparacion_importacion" ("expira_en") WHERE "estado" IN ('VALIDANDO','LISTA','EN_COLA','PROCESANDO')`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaOf(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."preparacion_importacion" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(`SELECT COUNT(*)::int AS total FROM ${s}."preparacion_importacion"`) as Array<{ total: number }>;
    if (Number(rows[0]?.total ?? 0) > 0) throw new Error('No se puede revertir: existen preparaciones de importación con historial.');
    await queryRunner.query(`DROP TABLE ${s}."preparacion_importacion"`);
  }
}
