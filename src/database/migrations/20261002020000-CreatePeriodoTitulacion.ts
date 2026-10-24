import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const options = queryRunner.connection.options as PostgresConnectionOptions;
  const schema = options.schema ?? 'public';
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) {
    throw new Error('El esquema configurado para períodos no es válido.');
  }
  return `"${schema}"`;
}

export class CreatePeriodoTitulacion20261002020000
  implements MigrationInterface
{
  name = 'CreatePeriodoTitulacion20261002020000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const schema = schemaName(queryRunner);
    await queryRunner.query(`
      CREATE TYPE ${schema}."periodo_titulacion_estado_enum" AS ENUM (
        'BORRADOR',
        'POSTULACION_ABIERTA',
        'POSTULACION_CERRADA',
        'EN_CURSO',
        'ARCHIVADO'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE ${schema}."periodo_titulacion" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "codigo" character varying(20) NOT NULL,
        "nombre" character varying(120) NOT NULL,
        "fecha_inicio_postulacion" TIMESTAMP WITH TIME ZONE NOT NULL,
        "fecha_fin_postulacion" TIMESTAMP WITH TIME ZONE NOT NULL,
        "fecha_inicio_titulacion" TIMESTAMP WITH TIME ZONE NOT NULL,
        "estado" ${schema}."periodo_titulacion_estado_enum" NOT NULL DEFAULT 'BORRADOR',
        "max_integrantes_default" smallint NOT NULL,
        CONSTRAINT "PK_periodo_titulacion" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_periodo_titulacion_codigo" UNIQUE ("codigo"),
        CONSTRAINT "CHK_periodo_titulacion_inicio_fin_postulacion"
          CHECK ("fecha_fin_postulacion" > "fecha_inicio_postulacion"),
        CONSTRAINT "CHK_periodo_titulacion_inicio_titulacion"
          CHECK ("fecha_inicio_titulacion" >= "fecha_fin_postulacion"),
        CONSTRAINT "CHK_periodo_titulacion_max_integrantes"
          CHECK ("max_integrantes_default" >= 1),
        CONSTRAINT "CHK_periodo_titulacion_codigo_no_vacio"
          CHECK (length(btrim("codigo")) > 0),
        CONSTRAINT "CHK_periodo_titulacion_nombre_no_vacio"
          CHECK (length(btrim("nombre")) > 0)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const schema = schemaName(queryRunner);
    await queryRunner.query(
      `LOCK TABLE ${schema}."periodo_titulacion" IN ACCESS EXCLUSIVE MODE`,
    );
    const rows = (await queryRunner.query(
      `SELECT COUNT(*)::int AS count FROM ${schema}."periodo_titulacion"`,
    )) as Array<{ count: number }>;

    if (Number(rows[0]?.count ?? 0) > 0) {
      throw new Error(
        'No se puede revertir la migración: la tabla periodo_titulacion contiene registros.',
      );
    }

    await queryRunner.query(`DROP TABLE ${schema}."periodo_titulacion"`);
    await queryRunner.query(
      `DROP TYPE ${schema}."periodo_titulacion_estado_enum"`,
    );
  }
}
