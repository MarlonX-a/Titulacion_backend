import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema configurado para la generación PAT de equipos no es válido.');
  return `"${schema}"`;
}

/**
 * `validar_generacion_pat_insert` as left by 20261124140000 (ADMIN may request on the student's
 * behalf), with the period check parameterised. With `admisionAbierta` a team created by ADMIN
 * (`origen = 'ADMIN'`) may generate its PAT while the period is POSTULACION_ABIERTA.
 */
function validarGeneracionSql(s: string, admisionAbierta: boolean): string {
  const estadoPeriodo = admisionAbierta
    ? `(v_estado_periodo NOT IN ('POSTULACION_CERRADA','EN_CURSO') AND NOT (v_origen='ADMIN' AND v_estado_periodo='POSTULACION_ABIERTA'))`
    : `v_estado_periodo NOT IN ('POSTULACION_CERRADA','EN_CURSO')`;
  return `
      CREATE OR REPLACE FUNCTION ${s}."validar_generacion_pat_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_periodo uuid; v_estado_periodo text; v_estado_asignacion text; v_titular uuid; v_grupo uuid; v_origen text;
        v_cuenta uuid; v_rol text; v_estado_usuario text; v_rol_actor text; v_estado_actor text;
      BEGIN
        SELECT "periodo_id" INTO v_periodo FROM ${s}."asignacion_tema" WHERE "id"=NEW."asignacion_tema_id";
        IF v_periodo IS NULL THEN RAISE EXCEPTION 'asignación de tema inexistente' USING ERRCODE='23503'; END IF;
        SELECT "estado"::text INTO v_estado_periodo FROM ${s}."periodo_titulacion" WHERE "id"=v_periodo FOR UPDATE;
        SELECT "estado"::text,"estudiante_id","grupo_id","origen"::text INTO v_estado_asignacion,v_titular,v_grupo,v_origen FROM ${s}."asignacion_tema" WHERE "id"=NEW."asignacion_tema_id" FOR UPDATE;
        IF ${estadoPeriodo} OR v_estado_asignacion<>'VIGENTE' OR (v_titular IS DISTINCT FROM NEW."estudiante_id" AND NOT EXISTS(SELECT 1 FROM ${s}."grupo_integrante" WHERE "grupo_id"=v_grupo AND "estudiante_id"=NEW."estudiante_id" AND "estado"='ACTIVO')) THEN
          RAISE EXCEPTION 'generación PAT requiere participación en asignación vigente' USING ERRCODE='23514';
        END IF;
        SELECT e."usuario_id",u."rol"::text,u."estado"::text INTO v_cuenta,v_rol,v_estado_usuario FROM ${s}."estudiante" e JOIN ${s}."usuario" u ON u."id"=e."usuario_id" WHERE e."id"=NEW."estudiante_id";
        IF v_rol<>'ESTUDIANTE' OR v_estado_usuario<>'ACTIVO' THEN RAISE EXCEPTION 'la generación pertenece a un estudiante activo' USING ERRCODE='23514'; END IF;
        IF v_cuenta IS DISTINCT FROM NEW."solicitada_por_id" THEN
          SELECT u."rol"::text,u."estado"::text INTO v_rol_actor,v_estado_actor FROM ${s}."usuario" u WHERE u."id"=NEW."solicitada_por_id";
          IF v_rol_actor IS DISTINCT FROM 'ADMIN' OR v_estado_actor IS DISTINCT FROM 'ACTIVO' THEN
            RAISE EXCEPTION 'la generación solo puede solicitarla el estudiante activo propietario o un ADMIN activo' USING ERRCODE='23514';
          END IF;
        END IF;
        RETURN NEW;
      END $$`;
}

/**
 * Equipos administrativos generan su PAT durante la postulación abierta (solo ADMIN opera ese
 * flujo en esta etapa). El resto de asignaciones mantiene CERRADA o EN_CURSO.
 */
export class GeneracionPatEquiposAbierta20261124160000 implements MigrationInterface {
  name = 'GeneracionPatEquiposAbierta20261124160000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(validarGeneracionSql(s, true));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    const abiertos = await queryRunner.query(`SELECT count(*)::int AS total FROM ${s}."generacion_pat" g JOIN ${s}."asignacion_tema" a ON a."id"=g."asignacion_tema_id" JOIN ${s}."periodo_titulacion" p ON p."id"=a."periodo_id" WHERE a."origen"='ADMIN' AND p."estado"='POSTULACION_ABIERTA'`) as Array<{ total: number }>;
    if (Number(abiertos[0]?.total ?? 0) > 0) {
      throw new Error('No se puede revertir la migración: existen generaciones PAT de equipos administrativos en un período en POSTULACION_ABIERTA.');
    }
    await queryRunner.query(validarGeneracionSql(s, false));
  }
}
