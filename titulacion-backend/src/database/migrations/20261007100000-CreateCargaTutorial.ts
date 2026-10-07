import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error('El esquema configurado para carga tutorial no es válido.');
  return `"${schema}"`;
}

export class CreateCargaTutorial20261007100000 implements MigrationInterface {
  name = 'CreateCargaTutorial20261007100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const schema = schemaName(queryRunner);
    await queryRunner.query(`
      CREATE TABLE ${schema}."config_carga_tutorial" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "periodo_id" uuid NOT NULL,
        "docente_id" uuid NULL,
        "max_trabajos" smallint NOT NULL,
        "bloquear_al_superar" boolean NOT NULL,
        CONSTRAINT "PK_config_carga_tutorial" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_config_carga_tutorial_periodo_docente" UNIQUE NULLS NOT DISTINCT ("periodo_id", "docente_id"),
        CONSTRAINT "CHK_config_carga_tutorial_max_trabajos" CHECK ("max_trabajos" >= 1),
        CONSTRAINT "FK_config_carga_tutorial_periodo" FOREIGN KEY ("periodo_id") REFERENCES ${schema}."periodo_titulacion"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_config_carga_tutorial_docente" FOREIGN KEY ("docente_id") REFERENCES ${schema}."docente"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_config_carga_tutorial_periodo" ON ${schema}."config_carga_tutorial" ("periodo_id", "docente_id", "id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const schema = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${schema}."config_carga_tutorial" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(`SELECT COUNT(*)::int AS count FROM ${schema}."config_carga_tutorial"`) as Array<{ count: number }>;
    if (Number(rows[0]?.count ?? 0) > 0) {
      throw new Error('No se puede revertir la migración: config_carga_tutorial contiene registros.');
    }
    await queryRunner.query(`DROP TABLE ${schema}."config_carga_tutorial"`);
  }
}
