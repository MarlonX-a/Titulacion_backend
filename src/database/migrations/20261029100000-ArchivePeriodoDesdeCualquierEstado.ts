import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error('El esquema configurado para archivar períodos no es válido.');
  }
  return `"${schema}"`;
}

/**
 * Permite archivar un período desde cualquier estado distinto de ARCHIVADO. ARCHIVADO sigue
 * siendo terminal e inmutable y no se puede insertar un período ya archivado. Solo reemplaza
 * el cuerpo de `validar_archivo_periodo`; el trigger y los bloqueos de tablas hijas no cambian.
 */
export class ArchivePeriodoDesdeCualquierEstado20261029100000 implements MigrationInterface {
  name = 'ArchivePeriodoDesdeCualquierEstado20261029100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."periodo_titulacion" IN SHARE ROW EXCLUSIVE MODE`);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION ${s}."validar_archivo_periodo"()
      RETURNS trigger LANGUAGE plpgsql AS $function$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW."estado" = 'ARCHIVADO' THEN
            RAISE EXCEPTION 'Un período no puede crearse en estado ARCHIVADO.' USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END IF;

        IF OLD."estado" = 'ARCHIVADO' AND NEW IS DISTINCT FROM OLD THEN
          RAISE EXCEPTION 'Un período archivado es inmutable.' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $function$
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."periodo_titulacion" IN SHARE ROW EXCLUSIVE MODE`);
    // Restaura el cuerpo original de 20261018100000. Los períodos ya archivados desde otros
    // estados se conservan: la función solo valida escrituras futuras.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION ${s}."validar_archivo_periodo"()
      RETURNS trigger LANGUAGE plpgsql AS $function$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW."estado" = 'ARCHIVADO' THEN
            RAISE EXCEPTION 'El archivo solo puede realizarse desde EN_CURSO.' USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END IF;

        IF OLD."estado" = 'ARCHIVADO' AND NEW IS DISTINCT FROM OLD THEN
          RAISE EXCEPTION 'Un período archivado es inmutable.' USING ERRCODE = '23514';
        END IF;
        IF NEW."estado" = 'ARCHIVADO' AND OLD."estado" <> 'EN_CURSO' THEN
          RAISE EXCEPTION 'El archivo solo puede realizarse desde EN_CURSO.' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $function$
    `);
  }
}
