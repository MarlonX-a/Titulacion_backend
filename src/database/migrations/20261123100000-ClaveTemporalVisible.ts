import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaOf(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema configurado no es válido.');
  return `"${schema}"`;
}

/** Conserva cifrada una copia recuperable de claves temporales hasta su consumo o vencimiento. */
export class ClaveTemporalVisible20261123100000 implements MigrationInterface {
  name = 'ClaveTemporalVisible20261123100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaOf(queryRunner);
    await queryRunner.query(`
      CREATE TABLE ${s}."clave_temporal_visible" (
        "usuario_id" uuid NOT NULL,
        "secreto_cifrado" text NOT NULL,
        "nonce" varchar(24) NOT NULL,
        "tag" varchar(32) NOT NULL,
        "expira_en" timestamptz NOT NULL,
        "actualizada_en" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_clave_temporal_visible" PRIMARY KEY ("usuario_id"),
        CONSTRAINT "FK_clave_temporal_visible_usuario" FOREIGN KEY ("usuario_id") REFERENCES ${s}."usuario"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_clave_temporal_visible_cifrado" CHECK (length("secreto_cifrado") > 0),
        CONSTRAINT "CHK_clave_temporal_visible_nonce" CHECK (length("nonce") = 24),
        CONSTRAINT "CHK_clave_temporal_visible_tag" CHECK (length("tag") = 32),
        CONSTRAINT "CHK_clave_temporal_visible_vigencia" CHECK ("expira_en" > "actualizada_en")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_clave_temporal_visible_expira" ON ${s}."clave_temporal_visible" ("expira_en")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaOf(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."clave_temporal_visible" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(`SELECT count(*)::integer AS total FROM ${s}."clave_temporal_visible"`) as Array<{ total: number }>;
    if (Number(rows[0]?.total ?? 0) > 0) throw new Error('No se puede revertir: existen claves temporales cifradas que aún pueden estar pendientes de activación.');
    await queryRunner.query(`DROP INDEX ${s}."IDX_clave_temporal_visible_expira"`);
    await queryRunner.query(`DROP TABLE ${s}."clave_temporal_visible"`);
  }
}
