import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error('El esquema configurado para la importación de docentes no es válido.');
  }
  return `"${schema}"`;
}

/**
 * Teacher imports are not tied to a period. `preparacion_importacion` gains the same `tipo` as
 * `lote_importacion` (whose CHECK already allows DOCENTES without period); student preparations
 * keep requiring a period and teacher preparations must not reference one.
 */
export class ImportacionDocentes20261020110000 implements MigrationInterface {
  name = 'ImportacionDocentes20261020110000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."preparacion_importacion" IN ACCESS EXCLUSIVE MODE`);
    await queryRunner.query(`ALTER TABLE ${s}."preparacion_importacion" ADD COLUMN "tipo" ${s}."lote_importacion_tipo_enum" NOT NULL DEFAULT 'ESTUDIANTES'`);
    await queryRunner.query(`ALTER TABLE ${s}."preparacion_importacion" ALTER COLUMN "periodo_id" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE ${s}."preparacion_importacion" ADD CONSTRAINT "CHK_preparacion_importacion_periodo_tipo" CHECK (("tipo" = 'ESTUDIANTES' AND "periodo_id" IS NOT NULL) OR ("tipo" = 'DOCENTES' AND "periodo_id" IS NULL))`);
    await queryRunner.query(`CREATE INDEX "IDX_preparacion_importacion_tipo" ON ${s}."preparacion_importacion" ("tipo", "creada_en" DESC)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."preparacion_importacion" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(`SELECT count(*)::int AS total FROM ${s}."preparacion_importacion" WHERE "tipo" = 'DOCENTES'`) as Array<{ total: number }>;
    if (Number(rows[0]?.total ?? 0) > 0) {
      throw new Error('No se puede revertir la migración: existen preparaciones de importación de docentes con historial.');
    }
    await queryRunner.query(`DROP INDEX ${s}."IDX_preparacion_importacion_tipo"`);
    await queryRunner.query(`ALTER TABLE ${s}."preparacion_importacion" DROP CONSTRAINT "CHK_preparacion_importacion_periodo_tipo"`);
    await queryRunner.query(`ALTER TABLE ${s}."preparacion_importacion" ALTER COLUMN "periodo_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE ${s}."preparacion_importacion" DROP COLUMN "tipo"`);
  }
}
