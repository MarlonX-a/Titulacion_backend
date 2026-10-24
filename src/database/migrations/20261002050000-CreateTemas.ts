import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error('El esquema configurado para temas no es válido.');
  return `"${schema}"`;
}

export class CreateTemas20261002050000 implements MigrationInterface {
  name = 'CreateTemas20261002050000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`CREATE TYPE ${s}."tema_estado_enum" AS ENUM ('BORRADOR', 'PUBLICADO', 'CERRADO', 'ASIGNADO', 'RETIRADO')`);
    await queryRunner.query(`
      CREATE TABLE ${s}."tema" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "periodo_id" uuid NOT NULL,
        "linea_id" uuid NOT NULL,
        "docente_proponente_id" uuid NOT NULL,
        "titulo" varchar(250) NOT NULL,
        "descripcion" text NOT NULL,
        "min_integrantes" smallint NOT NULL,
        "max_integrantes" smallint NOT NULL,
        "estado" ${s}."tema_estado_enum" NOT NULL DEFAULT 'BORRADOR',
        "creado_en" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_tema" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_tema_id_periodo" UNIQUE ("id", "periodo_id"),
        CONSTRAINT "FK_tema_periodo" FOREIGN KEY ("periodo_id") REFERENCES ${s}."periodo_titulacion"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_tema_linea" FOREIGN KEY ("linea_id") REFERENCES ${s}."linea_investigacion"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_tema_docente_proponente" FOREIGN KEY ("docente_proponente_id") REFERENCES ${s}."docente"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_tema_titulo_no_vacio" CHECK (length(btrim("titulo")) > 0),
        CONSTRAINT "CHK_tema_descripcion_no_vacia" CHECK (length(btrim("descripcion")) > 0),
        CONSTRAINT "CHK_tema_min_integrantes" CHECK ("min_integrantes" >= 1),
        CONSTRAINT "CHK_tema_max_integrantes" CHECK ("max_integrantes" >= "min_integrantes")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_tema_periodo_creado" ON ${s}."tema" ("periodo_id", "creado_en" DESC, "id" ASC)`);
    await queryRunner.query(`CREATE INDEX "IDX_tema_docente" ON ${s}."tema" ("docente_proponente_id", "creado_en" DESC, "id" ASC)`);
    await queryRunner.query(`CREATE INDEX "IDX_tema_linea" ON ${s}."tema" ("linea_id", "creado_en" DESC, "id" ASC)`);
    await queryRunner.query(`
      CREATE TABLE ${s}."tema_historial" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tema_id" uuid NOT NULL,
        "usuario_id" uuid NOT NULL,
        "estado_anterior" ${s}."tema_estado_enum" NULL,
        "estado_nuevo" ${s}."tema_estado_enum" NOT NULL,
        "cambios" jsonb NOT NULL,
        "fecha" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_tema_historial" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tema_historial_tema" FOREIGN KEY ("tema_id") REFERENCES ${s}."tema"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_tema_historial_usuario" FOREIGN KEY ("usuario_id") REFERENCES ${s}."usuario"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_tema_historial_tema_fecha" ON ${s}."tema_historial" ("tema_id", "fecha" ASC, "id" ASC)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."tema_historial", ${s}."tema" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(`SELECT (SELECT COUNT(*) FROM ${s}."tema")::int AS temas, (SELECT COUNT(*) FROM ${s}."tema_historial")::int AS historial`) as Array<{ temas: number; historial: number }>;
    if (Number(rows[0]?.temas ?? 0) > 0 || Number(rows[0]?.historial ?? 0) > 0) {
      throw new Error('No se puede revertir la migración: las tablas de temas contienen registros.');
    }
    await queryRunner.query(`DROP TABLE ${s}."tema_historial"`);
    await queryRunner.query(`DROP TABLE ${s}."tema"`);
    await queryRunner.query(`DROP TYPE ${s}."tema_estado_enum"`);
  }
}
