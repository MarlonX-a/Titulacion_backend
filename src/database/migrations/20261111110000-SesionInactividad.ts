import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error('El esquema configurado para la inactividad de sesiones no es válido.');
  }
  return `"${schema}"`;
}

/**
 * Las sesiones vencen tras 30 minutos sin uso real de la API (diseño S1, §3). La columna admite
 * `NULL`, que el servicio trata como sesión recién creada, por lo que las sesiones existentes
 * siguen siendo válidas. La reversión solo elimina la columna.
 */
export class SesionInactividad20261111110000 implements MigrationInterface {
  name = 'SesionInactividad20261111110000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`ALTER TABLE ${s}."sesion_usuario" ADD COLUMN "ultima_actividad" timestamptz NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`ALTER TABLE ${s}."sesion_usuario" DROP COLUMN "ultima_actividad"`);
  }
}
