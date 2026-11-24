import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema configurado para los equipos en postulación abierta no es válido.');
  return `"${schema}"`;
}

/**
 * `proteger_asignacion_tutor` as left by 20261123120000 (admin version), with the period check
 * parameterised. With `admisionAbierta` an ADMIN work may receive its tutor while the period is
 * POSTULACION_ABIERTA; every other origin keeps the previous states.
 */
function protegerTutorSql(s: string, admisionAbierta: boolean): string {
  const estadosPeriodo = admisionAbierta
    ? `v_period_state NOT IN ('POSTULACION_CERRADA','EN_CURSO') AND NOT (v_origen='ADMIN' AND v_period_state='POSTULACION_ABIERTA')`
    : `v_period_state NOT IN ('POSTULACION_CERRADA','EN_CURSO')`;
  return `
      CREATE OR REPLACE FUNCTION ${s}."proteger_asignacion_tutor"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_periodo uuid; v_estado text; v_tema_estado text; v_postulacion uuid; v_origen text;
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
        SELECT a."periodo_id",a."estado"::text,t."estado"::text,a."postulacion_id",a."origen"::text
          INTO v_periodo,v_estado,v_tema_estado,v_postulacion,v_origen
          FROM ${s}."asignacion_tema" a JOIN ${s}."tema" t ON t."id"=a."tema_id"
          WHERE a."id"=NEW."asignacion_tema_id" FOR UPDATE OF a,t;
        IF NOT FOUND OR v_estado<>'VIGENTE' OR v_tema_estado<>'ASIGNADO' OR (v_origen='POSTULACION' AND v_postulacion IS NULL) THEN
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
        IF NOT FOUND OR ${estadosPeriodo} THEN
          RAISE EXCEPTION 'el período no admite asignación de tutores' USING ERRCODE='23514';
        END IF;
        SELECT c."max_trabajos",c."bloquear_al_superar" INTO v_max,v_block
          FROM ${s}."config_carga_tutorial" c WHERE c."periodo_id"=v_periodo
            AND (c."docente_id"=NEW."docente_id" OR c."docente_id" IS NULL) AND c."activa"
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
 * Equipos administrativos también pueden conformarse con el período en POSTULACION_ABIERTA: ADMIN
 * es el único que opera ese flujo en la primera etapa. El tutor de un equipo ADMIN queda permitido
 * en POSTULACION_ABIERTA; las asignaciones por postulación siguen limitadas a CERRADA o EN_CURSO.
 */
export class EquiposPostulacionAbierta20261124150000 implements MigrationInterface {
  name = 'EquiposPostulacionAbierta20261124150000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(protegerTutorSql(s, true));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    const admin = await queryRunner.query(`SELECT count(*)::int AS total FROM ${s}."asignacion_tema" a JOIN ${s}."periodo_titulacion" p ON p."id"=a."periodo_id" WHERE a."origen"='ADMIN' AND p."estado"='POSTULACION_ABIERTA'`) as Array<{ total: number }>;
    if (Number(admin[0]?.total ?? 0) > 0) {
      throw new Error('No se puede revertir la migración: existen equipos administrativos en un período en POSTULACION_ABIERTA.');
    }
    await queryRunner.query(protegerTutorSql(s, false));
  }
}
