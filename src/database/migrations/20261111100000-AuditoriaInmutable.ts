import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error('El esquema configurado para la auditoría no es válido.');
  }
  return `"${schema}"`;
}

/**
 * La auditoría es historial: solo admite INSERT. UPDATE y DELETE (por fila) y TRUNCATE (por
 * sentencia) se rechazan en PostgreSQL con SQLSTATE 23514, igual que el historial de conflictos.
 * La reversión solo elimina los triggers y la función; no toca datos.
 */
export class AuditoriaInmutable20261111100000 implements MigrationInterface {
  name = 'AuditoriaInmutable20261111100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`
      CREATE FUNCTION ${s}."proteger_auditoria"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'la auditoría es histórica e inmutable: no se permite %', TG_OP USING ERRCODE='23514';
      END $$
    `);
    await queryRunner.query(`CREATE TRIGGER "TRG_auditoria_inmutable" BEFORE UPDATE OR DELETE ON ${s}."auditoria" FOR EACH ROW EXECUTE FUNCTION ${s}."proteger_auditoria"()`);
    await queryRunner.query(`CREATE TRIGGER "TRG_auditoria_sin_truncate" BEFORE TRUNCATE ON ${s}."auditoria" FOR EACH STATEMENT EXECUTE FUNCTION ${s}."proteger_auditoria"()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`DROP TRIGGER "TRG_auditoria_sin_truncate" ON ${s}."auditoria"`);
    await queryRunner.query(`DROP TRIGGER "TRG_auditoria_inmutable" ON ${s}."auditoria"`);
    await queryRunner.query(`DROP FUNCTION ${s}."proteger_auditoria"()`);
  }
}
