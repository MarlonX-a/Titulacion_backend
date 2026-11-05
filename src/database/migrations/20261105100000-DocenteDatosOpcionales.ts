import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error('El esquema configurado para los datos opcionales del docente no es válido.');
  }
  return `"${schema}"`;
}

/**
 * The institutional teacher workbook only provides names and contract type, so `cedula`,
 * `titulo_academico` and `departamento` become optional. The CHECKs still reject malformed or
 * blank values; `UQ_docente_cedula` keeps enforcing uniqueness (PostgreSQL allows many NULLs).
 */
export class DocenteDatosOpcionales20261105100000 implements MigrationInterface {
  name = 'DocenteDatosOpcionales20261105100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."docente" IN ACCESS EXCLUSIVE MODE`);
    await queryRunner.query(`ALTER TABLE ${s}."docente" DROP CONSTRAINT "CHK_docente_cedula_formato"`);
    await queryRunner.query(`ALTER TABLE ${s}."docente" DROP CONSTRAINT "CHK_docente_titulo_academico_no_vacio"`);
    await queryRunner.query(`ALTER TABLE ${s}."docente" DROP CONSTRAINT "CHK_docente_departamento_no_vacio"`);
    await queryRunner.query(`ALTER TABLE ${s}."docente" ALTER COLUMN "cedula" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE ${s}."docente" ALTER COLUMN "titulo_academico" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE ${s}."docente" ALTER COLUMN "departamento" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE ${s}."docente" ADD CONSTRAINT "CHK_docente_cedula_formato" CHECK ("cedula" IS NULL OR "cedula" ~ '^(0[1-9]|1[0-9]|2[0-4]|30)[0-9]{8}$')`);
    await queryRunner.query(`ALTER TABLE ${s}."docente" ADD CONSTRAINT "CHK_docente_titulo_academico_no_vacio" CHECK ("titulo_academico" IS NULL OR length(btrim("titulo_academico")) > 0)`);
    await queryRunner.query(`ALTER TABLE ${s}."docente" ADD CONSTRAINT "CHK_docente_departamento_no_vacio" CHECK ("departamento" IS NULL OR length(btrim("departamento")) > 0)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."docente" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(`SELECT count(*)::int AS total FROM ${s}."docente" WHERE "cedula" IS NULL OR "titulo_academico" IS NULL OR "departamento" IS NULL`) as Array<{ total: number }>;
    if (Number(rows[0]?.total ?? 0) > 0) {
      throw new Error('No se puede revertir la migración: existen docentes sin cédula, título o departamento.');
    }
    await queryRunner.query(`ALTER TABLE ${s}."docente" DROP CONSTRAINT "CHK_docente_cedula_formato"`);
    await queryRunner.query(`ALTER TABLE ${s}."docente" DROP CONSTRAINT "CHK_docente_titulo_academico_no_vacio"`);
    await queryRunner.query(`ALTER TABLE ${s}."docente" DROP CONSTRAINT "CHK_docente_departamento_no_vacio"`);
    await queryRunner.query(`ALTER TABLE ${s}."docente" ALTER COLUMN "cedula" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE ${s}."docente" ALTER COLUMN "titulo_academico" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE ${s}."docente" ALTER COLUMN "departamento" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE ${s}."docente" ADD CONSTRAINT "CHK_docente_cedula_formato" CHECK ("cedula" ~ '^(0[1-9]|1[0-9]|2[0-4]|30)[0-9]{8}$')`);
    await queryRunner.query(`ALTER TABLE ${s}."docente" ADD CONSTRAINT "CHK_docente_titulo_academico_no_vacio" CHECK (length(btrim("titulo_academico")) > 0)`);
    await queryRunner.query(`ALTER TABLE ${s}."docente" ADD CONSTRAINT "CHK_docente_departamento_no_vacio" CHECK (length(btrim("departamento")) > 0)`);
  }
}
