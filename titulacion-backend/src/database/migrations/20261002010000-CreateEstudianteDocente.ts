import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const options = queryRunner.connection.options as PostgresConnectionOptions;
  const schema = options.schema ?? 'public';
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) {
    throw new Error('El esquema configurado para perfiles no es válido.');
  }
  return `"${schema}"`;
}

export class CreateEstudianteDocente20261002010000
  implements MigrationInterface
{
  name = 'CreateEstudianteDocente20261002010000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const schema = schemaName(queryRunner);
    await queryRunner.query(`
      CREATE TABLE ${schema}."estudiante" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "usuario_id" uuid NOT NULL,
        "cedula" character varying(20) NOT NULL,
        "matricula" character varying(20) NOT NULL,
        "carrera" character varying(120) NOT NULL,
        "nivel" smallint NOT NULL,
        CONSTRAINT "PK_estudiante" PRIMARY KEY ("id"),
        CONSTRAINT "REL_8e18a9cefbd560324d29285640" UNIQUE ("usuario_id"),
        CONSTRAINT "UQ_estudiante_cedula" UNIQUE ("cedula"),
        CONSTRAINT "UQ_estudiante_matricula" UNIQUE ("matricula"),
        CONSTRAINT "FK_estudiante_usuario" FOREIGN KEY ("usuario_id")
          REFERENCES ${schema}."usuario"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_estudiante_cedula_formato"
          CHECK ("cedula" ~ '^(0[1-9]|1[0-9]|2[0-4]|30)[0-9]{8}$'),
        CONSTRAINT "CHK_estudiante_matricula_no_vacia"
          CHECK (length(btrim("matricula")) > 0),
        CONSTRAINT "CHK_estudiante_carrera_no_vacia"
          CHECK (length(btrim("carrera")) > 0),
        CONSTRAINT "CHK_estudiante_nivel_positivo" CHECK ("nivel" > 0)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE ${schema}."docente" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "usuario_id" uuid NOT NULL,
        "cedula" character varying(20) NOT NULL,
        "titulo_academico" character varying(120) NOT NULL,
        "departamento" character varying(120) NOT NULL,
        "habilitado_tutoria" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_docente" PRIMARY KEY ("id"),
        CONSTRAINT "REL_08c9b5035edf75a6e788f25ce9" UNIQUE ("usuario_id"),
        CONSTRAINT "UQ_docente_cedula" UNIQUE ("cedula"),
        CONSTRAINT "FK_docente_usuario" FOREIGN KEY ("usuario_id")
          REFERENCES ${schema}."usuario"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_docente_cedula_formato"
          CHECK ("cedula" ~ '^(0[1-9]|1[0-9]|2[0-4]|30)[0-9]{8}$'),
        CONSTRAINT "CHK_docente_titulo_academico_no_vacio"
          CHECK (length(btrim("titulo_academico")) > 0),
        CONSTRAINT "CHK_docente_departamento_no_vacio"
          CHECK (length(btrim("departamento")) > 0)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const schema = schemaName(queryRunner);
    const rows = (await queryRunner.query(`
      SELECT
        (SELECT COUNT(*) FROM ${schema}."estudiante")::int AS estudiantes,
        (SELECT COUNT(*) FROM ${schema}."docente")::int AS docentes
    `)) as Array<{ estudiantes: number; docentes: number }>;

    if (
      Number(rows[0]?.estudiantes ?? 0) > 0 ||
      Number(rows[0]?.docentes ?? 0) > 0
    ) {
      throw new Error(
        'No se puede revertir la migración: las tablas de perfiles contienen registros.',
      );
    }

    await queryRunner.query(`DROP TABLE ${schema}."docente"`);
    await queryRunner.query(`DROP TABLE ${schema}."estudiante"`);
  }
}
