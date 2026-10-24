import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

export class AllowExportCleanupKeys20261017110000 implements MigrationInterface {
  name = 'AllowExportCleanupKeys20261017110000';

  private schema(queryRunner: QueryRunner): string {
    const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
    if (typeof schema !== 'string' || !/^[a-z][a-z0-9_]{0,62}$/.test(schema)) {
      throw new Error('Esquema PostgreSQL configurado no válido.');
    }
    return `"${schema}"`;
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    const schema = this.schema(queryRunner);
    await queryRunner.query(`ALTER TABLE ${schema}."archivo_limpieza_pendiente" DROP CONSTRAINT "CHK_archivo_limpieza_ruta_privada"`);
    await queryRunner.query(`ALTER TABLE ${schema}."archivo_limpieza_pendiente" ADD CONSTRAINT "CHK_archivo_limpieza_ruta_privada" CHECK (
      "ruta_almacenamiento" LIKE 'plantillas-pat/%'
      OR "ruta_almacenamiento" LIKE 'documentos-pat/%'
      OR "ruta_almacenamiento" LIKE 'exportaciones/%'
    )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const schema = this.schema(queryRunner);
    await queryRunner.query(`LOCK TABLE ${schema}."archivo_limpieza_pendiente" IN ACCESS EXCLUSIVE MODE`);
    const pending = await queryRunner.query(`SELECT count(*)::int AS total FROM ${schema}."archivo_limpieza_pendiente" WHERE "ruta_almacenamiento" LIKE 'exportaciones/%'`) as Array<{ total: number }>;
    if (Number(pending[0]?.total ?? 0) > 0) {
      throw new Error('No se puede revertir mientras existan limpiezas de archivos de exportación pendientes.');
    }
    await queryRunner.query(`ALTER TABLE ${schema}."archivo_limpieza_pendiente" DROP CONSTRAINT "CHK_archivo_limpieza_ruta_privada"`);
    await queryRunner.query(`ALTER TABLE ${schema}."archivo_limpieza_pendiente" ADD CONSTRAINT "CHK_archivo_limpieza_ruta_privada" CHECK (
      "ruta_almacenamiento" LIKE 'plantillas-pat/%'
      OR "ruta_almacenamiento" LIKE 'documentos-pat/%'
    )`);
  }
}
