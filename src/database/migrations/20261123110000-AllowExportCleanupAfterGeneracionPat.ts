import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaOf(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema configurado no es válido.');
  return `"${schema}"`;
}

/** Restaura las claves de limpieza de exportaciones tras la migración de PAT individual. */
export class AllowExportCleanupAfterGeneracionPat20261123110000 implements MigrationInterface {
  name = 'AllowExportCleanupAfterGeneracionPat20261123110000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const schema = schemaOf(queryRunner);
    await queryRunner.query(`ALTER TABLE ${schema}."archivo_limpieza_pendiente" DROP CONSTRAINT "CHK_archivo_limpieza_ruta_privada"`);
    await queryRunner.query(`ALTER TABLE ${schema}."archivo_limpieza_pendiente" ADD CONSTRAINT "CHK_archivo_limpieza_ruta_privada" CHECK (
      "ruta_almacenamiento" LIKE 'plantillas-pat/%'
      OR "ruta_almacenamiento" LIKE 'documentos-pat/%'
      OR "ruta_almacenamiento" LIKE 'generaciones-pat/%'
      OR "ruta_almacenamiento" LIKE 'exportaciones/%'
    )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const schema = schemaOf(queryRunner);
    await queryRunner.query(`LOCK TABLE ${schema}."archivo_limpieza_pendiente" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(`SELECT count(*)::int AS total FROM ${schema}."archivo_limpieza_pendiente" WHERE "ruta_almacenamiento" LIKE 'exportaciones/%'`) as Array<{ total: number }>;
    if (Number(rows[0]?.total ?? 0) > 0) {
      throw new Error('No se puede revertir: existen limpiezas pendientes de archivos de exportación.');
    }
    await queryRunner.query(`ALTER TABLE ${schema}."archivo_limpieza_pendiente" DROP CONSTRAINT "CHK_archivo_limpieza_ruta_privada"`);
    await queryRunner.query(`ALTER TABLE ${schema}."archivo_limpieza_pendiente" ADD CONSTRAINT "CHK_archivo_limpieza_ruta_privada" CHECK (
      "ruta_almacenamiento" LIKE 'plantillas-pat/%'
      OR "ruta_almacenamiento" LIKE 'documentos-pat/%'
      OR "ruta_almacenamiento" LIKE 'generaciones-pat/%'
    )`);
  }
}
