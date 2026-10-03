import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const options = queryRunner.connection.options as PostgresConnectionOptions;
  const schema = options.schema ?? 'public';
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) {
    throw new Error('El esquema configurado para líneas de investigación no es válido.');
  }
  return `"${schema}"`;
}

export class CreateLineaInvestigacion20261002040000 implements MigrationInterface {
  name = 'CreateLineaInvestigacion20261002040000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const schema = schemaName(queryRunner);
    await queryRunner.query(`
      CREATE TABLE ${schema}."linea_investigacion" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "codigo" varchar(20) NOT NULL,
        "nombre" varchar(150) NOT NULL,
        "descripcion" text NULL,
        "activa" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_linea_investigacion" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_linea_investigacion_codigo" UNIQUE ("codigo"),
        CONSTRAINT "CHK_linea_investigacion_codigo_no_vacio" CHECK (length(btrim("codigo")) > 0),
        CONSTRAINT "CHK_linea_investigacion_nombre_no_vacio" CHECK (length(btrim("nombre")) > 0),
        CONSTRAINT "CHK_linea_investigacion_descripcion_no_vacia" CHECK ("descripcion" IS NULL OR length(btrim("descripcion")) > 0)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const schema = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${schema}."linea_investigacion" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(
      `SELECT COUNT(*)::int AS count FROM ${schema}."linea_investigacion"`,
    ) as Array<{ count: number }>;
    if (Number(rows[0]?.count ?? 0) > 0) {
      throw new Error('No se puede revertir la migración: la tabla linea_investigacion contiene registros.');
    }
    await queryRunner.query(`DROP TABLE ${schema}."linea_investigacion"`);
  }
}
