import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) {
    throw new Error('El esquema configurado para iniciar titulación no es válido.');
  }
  return `"${schema}"`;
}

export class StartPeriodoTitulacion20261016000000 implements MigrationInterface {
  name = 'StartPeriodoTitulacion20261016000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."periodo_titulacion" IN SHARE ROW EXCLUSIVE MODE`);
    await queryRunner.query(`LOCK TABLE ${s}."estudiante_habilitado" IN SHARE ROW EXCLUSIVE MODE`);

    const inconsistent = await queryRunner.query(`
      SELECT p."id"
      FROM ${s}."periodo_titulacion" p
      JOIN ${s}."estudiante_habilitado" h ON h."periodo_id" = p."id"
      WHERE p."estado" = 'EN_CURSO'
        AND h."condicion_ingreso" = 'CONDICIONADO'
        AND h."situacion_ingreso" = 'PENDIENTE'
      LIMIT 1
    `) as Array<{ id: string }>;
    if (inconsistent.length > 0) {
      throw new Error('No se puede instalar la protección: hay períodos EN_CURSO con condicionados pendientes.');
    }

    await queryRunner.query(`
      CREATE FUNCTION ${s}."validar_inicio_periodo_titulacion"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW."estado" = 'EN_CURSO' THEN
            RAISE EXCEPTION 'Un período debe iniciar desde POSTULACION_CERRADA.' USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END IF;

        IF NEW."estado" = 'EN_CURSO' AND OLD."estado" IS DISTINCT FROM NEW."estado" THEN
          IF OLD."estado" <> 'POSTULACION_CERRADA' THEN
            RAISE EXCEPTION 'La titulación solo puede iniciar desde POSTULACION_CERRADA.' USING ERRCODE = '23514';
          END IF;
          IF clock_timestamp() < NEW."fecha_inicio_titulacion" THEN
            RAISE EXCEPTION 'La fecha de inicio de titulación todavía no ha llegado.' USING ERRCODE = '23514';
          END IF;
          IF EXISTS (
            SELECT 1 FROM ${s}."estudiante_habilitado" h
            WHERE h."periodo_id" = NEW."id"
              AND h."condicion_ingreso" = 'CONDICIONADO'
              AND h."situacion_ingreso" = 'PENDIENTE'
          ) THEN
            RAISE EXCEPTION 'Existen condicionados pendientes de resolución.' USING ERRCODE = '23514';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $function$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_periodo_validar_inicio_titulacion"
      BEFORE INSERT OR UPDATE OF "estado" ON ${s}."periodo_titulacion"
      FOR EACH ROW EXECUTE FUNCTION ${s}."validar_inicio_periodo_titulacion"()
    `);

    await queryRunner.query(`
      CREATE FUNCTION ${s}."validar_habilitado_periodo_en_curso"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      DECLARE
        period_state ${s}."periodo_titulacion_estado_enum";
      BEGIN
        SELECT p."estado" INTO period_state
        FROM ${s}."periodo_titulacion" p
        WHERE p."id" = NEW."periodo_id"
        FOR UPDATE;

        IF period_state = 'EN_CURSO'
          AND NEW."condicion_ingreso" = 'CONDICIONADO'
          AND NEW."situacion_ingreso" = 'PENDIENTE' THEN
          RAISE EXCEPTION 'No se pueden introducir condicionados pendientes en un período EN_CURSO.' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $function$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_habilitado_bloquear_pendiente_en_curso"
      BEFORE INSERT OR UPDATE OF "periodo_id", "condicion_ingreso", "situacion_ingreso"
      ON ${s}."estudiante_habilitado"
      FOR EACH ROW EXECUTE FUNCTION ${s}."validar_habilitado_periodo_en_curso"()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."periodo_titulacion" IN ACCESS EXCLUSIVE MODE`);
    await queryRunner.query(`LOCK TABLE ${s}."estudiante_habilitado" IN ACCESS EXCLUSIVE MODE`);
    await queryRunner.query(`DROP TRIGGER "TRG_habilitado_bloquear_pendiente_en_curso" ON ${s}."estudiante_habilitado"`);
    await queryRunner.query(`DROP FUNCTION ${s}."validar_habilitado_periodo_en_curso"()`);
    await queryRunner.query(`DROP TRIGGER "TRG_periodo_validar_inicio_titulacion" ON ${s}."periodo_titulacion"`);
    await queryRunner.query(`DROP FUNCTION ${s}."validar_inicio_periodo_titulacion"()`);
  }
}
