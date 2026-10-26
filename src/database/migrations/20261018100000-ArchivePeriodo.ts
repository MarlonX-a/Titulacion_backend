import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error('El esquema configurado para archivar períodos no es válido.');
  }
  return `"${schema}"`;
}

const periodTables = [
  'estudiante_habilitado', 'lote_importacion', 'tema',
  'grupo', 'grupo_integrante', 'invitacion', 'postulacion',
  'resolucion_conflicto', 'asignacion_tema',
  'config_carga_tutorial', 'plantilla_pat',
];

export class ArchivePeriodo20261018100000 implements MigrationInterface {
  name = 'ArchivePeriodo20261018100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."periodo_titulacion" IN SHARE ROW EXCLUSIVE MODE`);

    await queryRunner.query(`
      CREATE FUNCTION ${s}."validar_archivo_periodo"()
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
    await queryRunner.query(`
      CREATE TRIGGER "TRG_periodo_archivo_terminal"
      BEFORE INSERT OR UPDATE ON ${s}."periodo_titulacion"
      FOR EACH ROW EXECUTE FUNCTION ${s}."validar_archivo_periodo"()
    `);

    await queryRunner.query(`
      CREATE FUNCTION ${s}."rechazar_escritura_periodo_archivado"()
      RETURNS trigger LANGUAGE plpgsql AS $function$
      DECLARE period_id uuid;
      DECLARE period_state ${s}."periodo_titulacion_estado_enum";
      BEGIN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        period_id := NEW."periodo_id";
        SELECT p."estado" INTO period_state
          FROM ${s}."periodo_titulacion" p
          WHERE p."id" = period_id
          FOR UPDATE;
        IF period_state = 'ARCHIVADO' THEN
          RAISE EXCEPTION 'No se permiten cambios en registros de un período archivado.' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $function$
    `);

    for (const table of periodTables) {
      await queryRunner.query(`
        CREATE TRIGGER "TRG_${table}_bloquear_periodo_archivado"
        BEFORE INSERT OR UPDATE ON ${s}."${table}"
        FOR EACH ROW EXECUTE FUNCTION ${s}."rechazar_escritura_periodo_archivado"()
      `);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    const tables = ['periodo_titulacion', ...periodTables].map((table) => `${s}."${table}"`).join(', ');
    await queryRunner.query(`LOCK TABLE ${tables} IN ACCESS EXCLUSIVE MODE`);
    for (const table of [...periodTables].reverse()) {
      await queryRunner.query(`DROP TRIGGER "TRG_${table}_bloquear_periodo_archivado" ON ${s}."${table}"`);
    }
    await queryRunner.query(`DROP FUNCTION ${s}."rechazar_escritura_periodo_archivado"()`);
    await queryRunner.query(`DROP TRIGGER "TRG_periodo_archivo_terminal" ON ${s}."periodo_titulacion"`);
    await queryRunner.query(`DROP FUNCTION ${s}."validar_archivo_periodo"()`);
  }
}
