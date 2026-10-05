import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error('El esquema configurado para grupos no es válido.');
  return `"${schema}"`;
}

export class GroupIntegrityLifecycle20261002070000 implements MigrationInterface {
  name = 'GroupIntegrityLifecycle20261002070000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."grupo", ${s}."grupo_integrante" IN SHARE ROW EXCLUSIVE MODE`);
    const invalid = await queryRunner.query(`
      SELECT g."id" FROM ${s}."grupo" g
      JOIN ${s}."periodo_titulacion" p ON p."id" = g."periodo_id"
      LEFT JOIN ${s}."grupo_integrante" m ON m."grupo_id" = g."id"
      GROUP BY g."id", g."estado", p."max_integrantes_default"
      HAVING (g."estado" = 'EN_CONFORMACION' AND (count(*) FILTER (WHERE m."estado" = 'ACTIVO') <> 1 OR count(*) FILTER (WHERE m."estado" = 'ACTIVO' AND m."rol_en_grupo" = 'REPRESENTANTE') <> 1))
        OR (g."estado" = 'ACTIVO' AND (count(*) FILTER (WHERE m."estado" = 'ACTIVO') < 2 OR count(*) FILTER (WHERE m."estado" = 'ACTIVO' AND m."rol_en_grupo" = 'REPRESENTANTE') <> 1))
        OR (g."estado" IN ('DISUELTO', 'ANULADO') AND count(*) FILTER (WHERE m."estado" = 'ACTIVO') <> 0)
        OR count(*) FILTER (WHERE m."estado" = 'ACTIVO') > p."max_integrantes_default"
      LIMIT 1
    `) as Array<{ id: string }>;
    if (invalid.length > 0) throw new Error('No se puede reforzar la integridad de grupos: existen grupos incompatibles con sus integrantes actuales.');

    await queryRunner.query(`CREATE OR REPLACE FUNCTION ${s}."validar_integridad_grupo"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_grupo_id uuid; v_estado text; v_periodo_id uuid; v_max smallint; v_total integer; v_representantes integer;
      BEGIN
        v_grupo_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END;
        IF TG_TABLE_NAME = 'grupo_integrante' THEN
          v_grupo_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."grupo_id" ELSE NEW."grupo_id" END;
        END IF;
        SELECT g."estado"::text, g."periodo_id", p."max_integrantes_default"
          INTO v_estado, v_periodo_id, v_max
          FROM ${s}."grupo" g JOIN ${s}."periodo_titulacion" p ON p."id" = g."periodo_id"
          WHERE g."id" = v_grupo_id;
        IF NOT FOUND THEN RETURN NULL; END IF;
        SELECT count(*) FILTER (WHERE "estado" = 'ACTIVO'), count(*) FILTER (WHERE "estado" = 'ACTIVO' AND "rol_en_grupo" = 'REPRESENTANTE')
          INTO v_total, v_representantes FROM ${s}."grupo_integrante" WHERE "grupo_id" = v_grupo_id;
        IF v_estado = 'EN_CONFORMACION' AND (v_total <> 1 OR v_representantes <> 1) THEN
          RAISE EXCEPTION 'grupo en conformación requiere exactamente un integrante representante' USING ERRCODE = '23514';
        END IF;
        IF v_estado = 'ACTIVO' AND (v_total < 2 OR v_representantes <> 1) THEN
          RAISE EXCEPTION 'grupo activo requiere al menos dos integrantes y un representante' USING ERRCODE = '23514';
        END IF;
        IF v_estado IN ('DISUELTO', 'ANULADO') AND v_total <> 0 THEN
          RAISE EXCEPTION 'grupo terminado no puede conservar integrantes activos' USING ERRCODE = '23514';
        END IF;
        IF v_total > v_max THEN
          RAISE EXCEPTION 'grupo supera el máximo de integrantes del período' USING ERRCODE = '23514';
        END IF;
        RETURN NULL;
      END $$`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."grupo", ${s}."grupo_integrante" IN SHARE ROW EXCLUSIVE MODE`);
    await queryRunner.query(`CREATE OR REPLACE FUNCTION ${s}."validar_integridad_grupo"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_grupo_id uuid; v_estado text; v_periodo_id uuid; v_max smallint; v_total integer; v_representantes integer;
      BEGIN
        v_grupo_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END;
        IF TG_TABLE_NAME = 'grupo_integrante' THEN
          v_grupo_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."grupo_id" ELSE NEW."grupo_id" END;
        END IF;
        SELECT g."estado"::text, g."periodo_id", p."max_integrantes_default"
          INTO v_estado, v_periodo_id, v_max
          FROM ${s}."grupo" g JOIN ${s}."periodo_titulacion" p ON p."id" = g."periodo_id"
          WHERE g."id" = v_grupo_id;
        IF NOT FOUND THEN RETURN NULL; END IF;
        SELECT count(*) FILTER (WHERE "estado" = 'ACTIVO'), count(*) FILTER (WHERE "estado" = 'ACTIVO' AND "rol_en_grupo" = 'REPRESENTANTE')
          INTO v_total, v_representantes FROM ${s}."grupo_integrante" WHERE "grupo_id" = v_grupo_id;
        IF v_estado IN ('EN_CONFORMACION', 'ACTIVO') AND v_representantes <> 1 THEN
          RAISE EXCEPTION 'grupo debe terminar la transacción con un representante activo' USING ERRCODE = '23514';
        END IF;
        IF v_estado = 'ACTIVO' AND v_total < 2 THEN
          RAISE EXCEPTION 'grupo activo requiere al menos dos integrantes' USING ERRCODE = '23514';
        END IF;
        IF v_total > v_max THEN
          RAISE EXCEPTION 'grupo supera el máximo de integrantes del período' USING ERRCODE = '23514';
        END IF;
        RETURN NULL;
      END $$`);
  }
}
