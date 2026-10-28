import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error('El esquema configurado para desactivar límites de carga tutorial no es válido.');
  }
  return `"${schema}"`;
}

/**
 * Same body as CreateAsignacionesTutor20261008100000; only the effective-configuration lookup
 * changes when `onlyActive` is true so a deactivated specific limit falls back to the global one.
 */
function tutorProtectionFunction(s: string, onlyActive: boolean): string {
  const activeFilter = onlyActive ? ' AND c."activa"' : '';
  return `
      CREATE OR REPLACE FUNCTION ${s}."proteger_asignacion_tutor"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_periodo uuid; v_estado text; v_tema_estado text; v_postulacion uuid;
        v_teacher_active text; v_teacher_role text; v_enabled boolean;
        v_max smallint; v_block boolean; v_count integer; v_period_state text;
      BEGIN
        IF TG_OP='DELETE' THEN
          RAISE EXCEPTION 'las asignaciones de tutor son históricas y no se eliminan' USING ERRCODE='23514';
        END IF;
        IF TG_OP='UPDATE' THEN
          IF OLD."estado"<>'VIGENTE' OR NEW."estado" NOT IN ('REEMPLAZADA','ANULADA') OR
             (to_jsonb(NEW)-ARRAY['estado','fecha_fin','motivo_cambio']) IS DISTINCT FROM
             (to_jsonb(OLD)-ARRAY['estado','fecha_fin','motivo_cambio']) OR
             NEW."fecha_fin" IS NULL OR NEW."motivo_cambio" IS NULL OR length(btrim(NEW."motivo_cambio")) NOT BETWEEN 1 AND 1000 THEN
            RAISE EXCEPTION 'solo se permite reemplazar o anular una asignación vigente conservando su historia' USING ERRCODE='23514';
          END IF;
          RETURN NEW;
        END IF;
        IF NEW."estado"<>'VIGENTE' THEN RAISE EXCEPTION 'las asignaciones nuevas deben estar vigentes' USING ERRCODE='23514'; END IF;
        SELECT a."periodo_id",a."estado"::text,t."estado"::text,p."id"
          INTO v_periodo,v_estado,v_tema_estado,v_postulacion
          FROM ${s}."asignacion_tema" a JOIN ${s}."tema" t ON t."id"=a."tema_id"
          JOIN ${s}."postulacion" p ON p."id"=a."postulacion_id"
          WHERE a."id"=NEW."asignacion_tema_id" FOR UPDATE OF a,t;
        IF NOT FOUND OR v_estado<>'VIGENTE' OR v_tema_estado<>'ASIGNADO' OR v_postulacion IS NULL THEN
          RAISE EXCEPTION 'solo se asigna tutor a un trabajo vigente y asignado' USING ERRCODE='23514';
        END IF;
        IF NEW."tutor_propuesto_id" IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM ${s}."tutor_propuesto" p WHERE p."id"=NEW."tutor_propuesto_id"
            AND p."docente_id"=NEW."docente_id" AND p."postulacion_id"=v_postulacion
        ) THEN RAISE EXCEPTION 'la preferencia no corresponde al trabajo y docente elegidos' USING ERRCODE='23514'; END IF;
        SELECT u."estado"::text,u."rol"::text,d."habilitado_tutoria"
          INTO v_teacher_active,v_teacher_role,v_enabled FROM ${s}."docente" d
          JOIN ${s}."usuario" u ON u."id"=d."usuario_id" WHERE d."id"=NEW."docente_id" FOR UPDATE OF d,u;
        IF NOT FOUND OR v_teacher_active<>'ACTIVO' OR v_teacher_role<>'DOCENTE' OR v_enabled IS DISTINCT FROM true THEN
          RAISE EXCEPTION 'el docente debe estar activo y habilitado para tutoría' USING ERRCODE='23514';
        END IF;
        SELECT "estado"::text INTO v_period_state FROM ${s}."periodo_titulacion" WHERE "id"=v_periodo FOR UPDATE;
        IF NOT FOUND OR v_period_state NOT IN ('POSTULACION_CERRADA','EN_CURSO') THEN
          RAISE EXCEPTION 'el período no admite asignación de tutores' USING ERRCODE='23514';
        END IF;
        SELECT c."max_trabajos",c."bloquear_al_superar" INTO v_max,v_block
          FROM ${s}."config_carga_tutorial" c WHERE c."periodo_id"=v_periodo
            AND (c."docente_id"=NEW."docente_id" OR c."docente_id" IS NULL)${activeFilter}
          ORDER BY (c."docente_id" IS NULL) ASC LIMIT 1;
        IF NOT FOUND THEN RAISE EXCEPTION 'falta configuración de carga tutorial aplicable' USING ERRCODE='23514'; END IF;
        SELECT count(*)::int INTO v_count FROM ${s}."asignacion_tutor" current_tutor
          JOIN ${s}."asignacion_tema" current_work ON current_work."id"=current_tutor."asignacion_tema_id"
          WHERE current_work."periodo_id"=v_periodo AND current_work."estado"='VIGENTE'
            AND current_tutor."docente_id"=NEW."docente_id" AND current_tutor."estado"='VIGENTE';
        IF v_block AND v_count+1>v_max THEN RAISE EXCEPTION 'el docente superaría el máximo de carga configurado' USING ERRCODE='23514'; END IF;
        RETURN NEW;
      END $$
    `;
}

/**
 * Specific tutoring-load limits are deactivated instead of deleted (RF carga tutorial). An
 * inactive row is history: it no longer applies, cannot be modified and a new specific limit
 * may be created for the same teacher. The global limit of a period is never deactivated.
 */
export class DesactivarConfigCargaTutorial20261020100000 implements MigrationInterface {
  name = 'DesactivarConfigCargaTutorial20261020100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."config_carga_tutorial" IN ACCESS EXCLUSIVE MODE`);
    await queryRunner.query(`ALTER TABLE ${s}."config_carga_tutorial" ADD COLUMN "activa" boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`ALTER TABLE ${s}."config_carga_tutorial" ADD CONSTRAINT "CHK_config_carga_tutorial_global_activa" CHECK ("docente_id" IS NOT NULL OR "activa")`);
    await queryRunner.query(`ALTER TABLE ${s}."config_carga_tutorial" DROP CONSTRAINT "UQ_config_carga_tutorial_periodo_docente"`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_config_carga_tutorial_global" ON ${s}."config_carga_tutorial" ("periodo_id") WHERE "docente_id" IS NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_config_carga_tutorial_docente_activa" ON ${s}."config_carga_tutorial" ("periodo_id", "docente_id") WHERE "docente_id" IS NOT NULL AND "activa"`);
    await queryRunner.query(`
      CREATE FUNCTION ${s}."proteger_config_carga_inactiva"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD."activa" = false AND NEW IS DISTINCT FROM OLD THEN
          RAISE EXCEPTION 'un límite de carga desactivado es histórico y no se modifica' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$
    `);
    await queryRunner.query(`CREATE TRIGGER "TRG_config_carga_inactiva_inmutable" BEFORE UPDATE ON ${s}."config_carga_tutorial" FOR EACH ROW EXECUTE FUNCTION ${s}."proteger_config_carga_inactiva"()`);
    if (await this.tutorProtectionExists(queryRunner, s)) {
      await queryRunner.query(tutorProtectionFunction(s, true));
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."config_carga_tutorial" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(`SELECT count(*)::int AS total FROM ${s}."config_carga_tutorial" WHERE NOT "activa"`) as Array<{ total: number }>;
    if (Number(rows[0]?.total ?? 0) > 0) {
      throw new Error('No se puede revertir la migración: existen límites de carga desactivados con historial.');
    }
    if (await this.tutorProtectionExists(queryRunner, s)) {
      await queryRunner.query(tutorProtectionFunction(s, false));
    }
    await queryRunner.query(`DROP TRIGGER "TRG_config_carga_inactiva_inmutable" ON ${s}."config_carga_tutorial"`);
    await queryRunner.query(`DROP FUNCTION ${s}."proteger_config_carga_inactiva"()`);
    await queryRunner.query(`DROP INDEX ${s}."UQ_config_carga_tutorial_docente_activa"`);
    await queryRunner.query(`DROP INDEX ${s}."UQ_config_carga_tutorial_global"`);
    await queryRunner.query(`ALTER TABLE ${s}."config_carga_tutorial" ADD CONSTRAINT "UQ_config_carga_tutorial_periodo_docente" UNIQUE NULLS NOT DISTINCT ("periodo_id", "docente_id")`);
    await queryRunner.query(`ALTER TABLE ${s}."config_carga_tutorial" DROP CONSTRAINT "CHK_config_carga_tutorial_global_activa"`);
    await queryRunner.query(`ALTER TABLE ${s}."config_carga_tutorial" DROP COLUMN "activa"`);
  }

  private async tutorProtectionExists(queryRunner: QueryRunner, s: string): Promise<boolean> {
    const rows = await queryRunner.query(`SELECT to_regprocedure($1) AS fn`, [`${s}."proteger_asignacion_tutor"()`]) as Array<{ fn: string | null }>;
    return rows[0]?.fn !== null && rows[0]?.fn !== undefined;
  }
}
