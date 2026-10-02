import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const options = queryRunner.connection.options as PostgresConnectionOptions;
  const schema = options.schema ?? 'public';
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) {
    throw new Error('El esquema configurado para usuarios no es válido.');
  }
  return `"${schema}"`;
}

export class CreateUsuario20261002000000 implements MigrationInterface {
  name = 'CreateUsuario20261002000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const schema = schemaName(queryRunner);
    await queryRunner.query(
      `CREATE TYPE ${schema}."usuario_rol_enum" AS ENUM ('ESTUDIANTE', 'DOCENTE', 'ADMIN')`,
    );
    await queryRunner.query(
      `CREATE TYPE ${schema}."usuario_estado_enum" AS ENUM ('ACTIVO', 'INACTIVO')`,
    );
    await queryRunner.query(`
      CREATE TABLE ${schema}."usuario" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" character varying(150) NOT NULL,
        "nombres" character varying(100) NOT NULL,
        "apellidos" character varying(100) NOT NULL,
        "rol" ${schema}."usuario_rol_enum" NOT NULL,
        "estado" ${schema}."usuario_estado_enum" NOT NULL DEFAULT 'ACTIVO',
        "id_externo_sso" character varying(100) NOT NULL,
        "ultimo_acceso" TIMESTAMP WITH TIME ZONE,
        "creado_en" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_usuario" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_usuario_email" UNIQUE ("email"),
        CONSTRAINT "UQ_usuario_id_externo_sso" UNIQUE ("id_externo_sso"),
        CONSTRAINT "CHK_usuario_email_normalizado"
          CHECK ("email" = lower(btrim("email"))),
        CONSTRAINT "CHK_usuario_nombres_no_vacios"
          CHECK (length(btrim("nombres")) > 0),
        CONSTRAINT "CHK_usuario_apellidos_no_vacios"
          CHECK (length(btrim("apellidos")) > 0),
        CONSTRAINT "CHK_usuario_id_externo_sso_no_vacio"
          CHECK (length(btrim("id_externo_sso")) > 0)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const schema = schemaName(queryRunner);
    const rows = (await queryRunner.query(
      `SELECT COUNT(*)::int AS count FROM ${schema}."usuario"`,
    )) as Array<{ count: number }>;

    if (Number(rows[0]?.count ?? 0) > 0) {
      throw new Error(
        'No se puede revertir la migración: la tabla usuario contiene registros.',
      );
    }

    await queryRunner.query(`DROP TABLE ${schema}."usuario"`);
    await queryRunner.query(`DROP TYPE ${schema}."usuario_estado_enum"`);
    await queryRunner.query(`DROP TYPE ${schema}."usuario_rol_enum"`);
  }
}
