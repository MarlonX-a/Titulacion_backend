import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error('El esquema configurado para los índices de auditoría no es válido.');
  }
  return `"${schema}"`;
}

/**
 * Supports `GET /auditoria`: the default view pages the whole log by (fecha_hora DESC, id DESC)
 * and the actor filter uses usuario_id (an FK without its own index). `IDX_auditoria_entidad`
 * already covers the entity filters. Indexes only; no data changes.
 */
export class IndicesConsultaAuditoria20261027100000 implements MigrationInterface {
  name = 'IndicesConsultaAuditoria20261027100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`CREATE INDEX "IDX_auditoria_fecha_hora" ON ${s}."auditoria" ("fecha_hora" DESC, "id" DESC)`);
    await queryRunner.query(`CREATE INDEX "IDX_auditoria_usuario" ON ${s}."auditoria" ("usuario_id", "fecha_hora" DESC)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`DROP INDEX ${s}."IDX_auditoria_usuario"`);
    await queryRunner.query(`DROP INDEX ${s}."IDX_auditoria_fecha_hora"`);
  }
}
