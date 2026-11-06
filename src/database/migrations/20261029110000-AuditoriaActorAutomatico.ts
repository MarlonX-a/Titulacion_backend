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
 * Permite auditar transiciones automáticas del sistema sin un usuario responsable. Un registro
 * sin `usuario_id` solo es válido si `valores_nuevos.automatico` es `true`, de modo que las
 * acciones manuales siguen exigiendo actor. La reversión se rechaza si ya existen registros
 * automáticos, para no perder historial.
 */
export class AuditoriaActorAutomatico20261029110000 implements MigrationInterface {
  name = 'AuditoriaActorAutomatico20261029110000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`ALTER TABLE ${s}."auditoria" ALTER COLUMN "usuario_id" DROP NOT NULL`);
    await queryRunner.query(`
      ALTER TABLE ${s}."auditoria" ADD CONSTRAINT "CHK_auditoria_actor_o_automatico"
      CHECK ("usuario_id" IS NOT NULL OR COALESCE(("valores_nuevos" ->> 'automatico') = 'true', false))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."auditoria" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(
      `SELECT count(*)::int AS total FROM ${s}."auditoria" WHERE "usuario_id" IS NULL`,
    ) as Array<{ total: number }>;
    if (Number(rows[0]?.total ?? 0) > 0) {
      throw new Error('No se puede revertir: existen auditorías automáticas sin usuario que se perderían.');
    }
    await queryRunner.query(`ALTER TABLE ${s}."auditoria" DROP CONSTRAINT "CHK_auditoria_actor_o_automatico"`);
    await queryRunner.query(`ALTER TABLE ${s}."auditoria" ALTER COLUMN "usuario_id" SET NOT NULL`);
  }
}
