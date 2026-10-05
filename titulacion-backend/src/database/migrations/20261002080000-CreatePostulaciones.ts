import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema configurado para postulaciones no es válido.');
  return `"${schema}"`;
}

export class CreatePostulaciones20261002080000 implements MigrationInterface {
  name = 'CreatePostulaciones20261002080000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`CREATE TYPE ${s}."postulacion_estado_enum" AS ENUM ('PENDIENTE','EN_CONFLICTO','ACEPTADA','RECHAZADA','CANCELADA','ANULADA')`);
    await queryRunner.query(`
      CREATE TABLE ${s}."postulacion" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(), "tema_id" uuid NOT NULL, "periodo_id" uuid NOT NULL,
        "grupo_id" uuid NULL, "estudiante_id" uuid NULL, "num_integrantes" smallint NOT NULL,
        "registrada_por_id" uuid NOT NULL, "estado" ${s}."postulacion_estado_enum" NOT NULL DEFAULT 'PENDIENTE',
        "fecha_postulacion" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, "observacion" text NULL,
        CONSTRAINT "PK_postulacion" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_postulacion_id_tema" UNIQUE ("id","tema_id"),
        CONSTRAINT "UQ_postulacion_id_grupo" UNIQUE ("id","grupo_id"),
        CONSTRAINT "UQ_postulacion_id_estudiante" UNIQUE ("id","estudiante_id"),
        CONSTRAINT "FK_postulacion_tema_periodo" FOREIGN KEY ("tema_id","periodo_id") REFERENCES ${s}."tema"("id","periodo_id") ON DELETE RESTRICT,
        CONSTRAINT "FK_postulacion_grupo_periodo" FOREIGN KEY ("grupo_id","periodo_id") REFERENCES ${s}."grupo"("id","periodo_id") ON DELETE RESTRICT,
        CONSTRAINT "FK_postulacion_habilitado" FOREIGN KEY ("periodo_id","estudiante_id") REFERENCES ${s}."estudiante_habilitado"("periodo_id","estudiante_id") ON DELETE RESTRICT,
        CONSTRAINT "FK_postulacion_registrada_por" FOREIGN KEY ("registrada_por_id") REFERENCES ${s}."usuario"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_postulacion_modalidad_exclusiva" CHECK (("grupo_id" IS NULL) <> ("estudiante_id" IS NULL)),
        CONSTRAINT "CHK_postulacion_num_integrantes" CHECK (("estudiante_id" IS NOT NULL AND "num_integrantes" = 1) OR ("grupo_id" IS NOT NULL AND "num_integrantes" >= 2)),
        CONSTRAINT "CHK_postulacion_observacion" CHECK ("observacion" IS NULL OR length(btrim("observacion")) > 0)
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_postulacion_periodo_fecha" ON ${s}."postulacion" ("periodo_id","fecha_postulacion" DESC,"id" ASC)`);
    await queryRunner.query(`CREATE INDEX "IDX_postulacion_tema_fecha" ON ${s}."postulacion" ("tema_id","fecha_postulacion" DESC)`);
    await queryRunner.query(`CREATE INDEX "IDX_postulacion_estado" ON ${s}."postulacion" ("periodo_id","estado")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_postulacion_activa_grupo" ON ${s}."postulacion" ("periodo_id","grupo_id") WHERE "grupo_id" IS NOT NULL AND "estado" IN ('PENDIENTE','EN_CONFLICTO','ACEPTADA')`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_postulacion_activa_estudiante" ON ${s}."postulacion" ("periodo_id","estudiante_id") WHERE "estudiante_id" IS NOT NULL AND "estado" IN ('PENDIENTE','EN_CONFLICTO','ACEPTADA')`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_postulacion_tema_grupo_no_cancelada" ON ${s}."postulacion" ("tema_id","grupo_id") WHERE "grupo_id" IS NOT NULL AND "estado" <> 'CANCELADA'`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_postulacion_tema_estudiante_no_cancelada" ON ${s}."postulacion" ("tema_id","estudiante_id") WHERE "estudiante_id" IS NOT NULL AND "estado" <> 'CANCELADA'`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_postulacion_tema_aceptada" ON ${s}."postulacion" ("tema_id") WHERE "estado" = 'ACEPTADA'`);

    await queryRunner.query(`
      CREATE FUNCTION ${s}."validar_postulacion_y_bloquear_periodo"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_estado_periodo text; v_inicio timestamptz; v_fin timestamptz; v_tema_estado text; v_min smallint; v_max smallint; v_num integer; v_habilitados integer;
      BEGIN
        IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'las postulaciones son históricas y no se eliminan físicamente' USING ERRCODE='23514'; END IF;
        IF TG_OP = 'UPDATE' THEN
          IF OLD."estado" <> 'PENDIENTE' OR NEW."estado" <> 'CANCELADA' OR NEW."id"<>OLD."id" OR NEW."tema_id"<>OLD."tema_id" OR NEW."periodo_id"<>OLD."periodo_id" OR NEW."grupo_id" IS DISTINCT FROM OLD."grupo_id" OR NEW."estudiante_id" IS DISTINCT FROM OLD."estudiante_id" OR NEW."num_integrantes"<>OLD."num_integrantes" OR NEW."registrada_por_id"<>OLD."registrada_por_id" OR NEW."fecha_postulacion"<>OLD."fecha_postulacion" OR NEW."observacion" IS NULL OR length(btrim(NEW."observacion"))=0 THEN RAISE EXCEPTION 'solo se permite cancelar postulaciones pendientes' USING ERRCODE='23514'; END IF;
          RETURN NEW;
        END IF;
        SELECT "estado"::text,"fecha_inicio_postulacion","fecha_fin_postulacion" INTO v_estado_periodo,v_inicio,v_fin FROM ${s}."periodo_titulacion" WHERE "id"=NEW."periodo_id" FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'período inexistente' USING ERRCODE='23503'; END IF;
        SELECT "estado"::text,"min_integrantes","max_integrantes" INTO v_tema_estado,v_min,v_max FROM ${s}."tema" WHERE "id"=NEW."tema_id" AND "periodo_id"=NEW."periodo_id" FOR UPDATE;
        IF NOT FOUND OR v_tema_estado <> 'PUBLICADO' THEN RAISE EXCEPTION 'tema no publicado para el período' USING ERRCODE='23514'; END IF;
        IF v_estado_periodo <> 'POSTULACION_ABIERTA' OR clock_timestamp() < v_inicio OR clock_timestamp() >= v_fin THEN RAISE EXCEPTION 'fuera del plazo de postulación' USING ERRCODE='23514'; END IF;
        IF NEW."estudiante_id" IS NOT NULL THEN
          IF EXISTS (SELECT 1 FROM ${s}."grupo_integrante" WHERE "periodo_id"=NEW."periodo_id" AND "estudiante_id"=NEW."estudiante_id" AND "estado"='ACTIVO') THEN RAISE EXCEPTION 'estudiante pertenece a un grupo' USING ERRCODE='23514'; END IF;
          SELECT count(*) INTO v_habilitados FROM ${s}."estudiante_habilitado" h JOIN ${s}."estudiante" e ON e."id"=h."estudiante_id" JOIN ${s}."usuario" u ON u."id"=e."usuario_id" WHERE h."periodo_id"=NEW."periodo_id" AND h."estudiante_id"=NEW."estudiante_id" AND h."estado"='HABILITADO' AND h."situacion_ingreso" IN ('PENDIENTE','ADMITIDO') AND u."estado"='ACTIVO' AND u."rol"='ESTUDIANTE';
          IF v_habilitados <> 1 THEN RAISE EXCEPTION 'estudiante no habilitado' USING ERRCODE='23514'; END IF;
          NEW."num_integrantes" := 1;
        ELSE
          SELECT count(*) INTO v_num FROM ${s}."grupo_integrante" WHERE "grupo_id"=NEW."grupo_id" AND "periodo_id"=NEW."periodo_id" AND "estado"='ACTIVO';
          IF v_num < 2 OR v_num <> NEW."num_integrantes" THEN RAISE EXCEPTION 'composición de grupo incompatible' USING ERRCODE='23514'; END IF;
          IF EXISTS (SELECT 1 FROM ${s}."grupo_integrante" m JOIN ${s}."estudiante_habilitado" h ON h."periodo_id"=m."periodo_id" AND h."estudiante_id"=m."estudiante_id" JOIN ${s}."estudiante" e ON e."id"=m."estudiante_id" JOIN ${s}."usuario" u ON u."id"=e."usuario_id" WHERE m."grupo_id"=NEW."grupo_id" AND m."estado"='ACTIVO' AND (h."estado"<>'HABILITADO' OR h."situacion_ingreso" NOT IN ('PENDIENTE','ADMITIDO') OR u."estado"<>'ACTIVO' OR u."rol"<>'ESTUDIANTE')) THEN RAISE EXCEPTION 'participantes no elegibles' USING ERRCODE='23514'; END IF;
          IF EXISTS (SELECT 1 FROM ${s}."grupo_integrante" m JOIN ${s}."postulacion" p ON p."periodo_id"=m."periodo_id" AND p."estudiante_id"=m."estudiante_id" WHERE m."grupo_id"=NEW."grupo_id" AND m."estado"='ACTIVO' AND p."estado" IN ('PENDIENTE','EN_CONFLICTO','ACEPTADA')) THEN RAISE EXCEPTION 'participante con postulación individual activa' USING ERRCODE='23514'; END IF;
        END IF;
        IF NEW."num_integrantes" < v_min OR NEW."num_integrantes" > v_max THEN RAISE EXCEPTION 'cantidad de integrantes fuera del rango del tema' USING ERRCODE='23514'; END IF;
        RETURN NEW;
      END $$
    `);
    await queryRunner.query(`CREATE TRIGGER "TRG_postulacion_validate" BEFORE INSERT OR UPDATE OR DELETE ON ${s}."postulacion" FOR EACH ROW EXECUTE FUNCTION ${s}."validar_postulacion_y_bloquear_periodo"()`);

    await queryRunner.query(`
      CREATE FUNCTION ${s}."proteger_composicion_postulacion"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_periodo uuid; v_grupo uuid; v_individual boolean;
      BEGIN
        v_periodo := CASE WHEN TG_OP='DELETE' THEN OLD."periodo_id" ELSE NEW."periodo_id" END;
        v_grupo := CASE WHEN TG_OP='DELETE' THEN OLD."grupo_id" ELSE NEW."grupo_id" END;
        PERFORM 1 FROM ${s}."periodo_titulacion" WHERE "id"=v_periodo FOR UPDATE;
        IF TG_OP='INSERT' THEN
          IF EXISTS (SELECT 1 FROM ${s}."postulacion" WHERE "grupo_id"=NEW."grupo_id") THEN RAISE EXCEPTION 'la composición del grupo está cerrada por una postulación' USING ERRCODE='23514'; END IF;
          SELECT EXISTS(SELECT 1 FROM ${s}."postulacion" WHERE "periodo_id"=NEW."periodo_id" AND "estudiante_id"=NEW."estudiante_id" AND "estado" IN ('PENDIENTE','EN_CONFLICTO','ACEPTADA')) INTO v_individual;
          IF v_individual THEN RAISE EXCEPTION 'estudiante con postulación individual activa' USING ERRCODE='23505'; END IF;
          RETURN NEW;
        END IF;
        IF TG_OP='UPDATE' AND NEW."grupo_id"=OLD."grupo_id" AND NEW."periodo_id"=OLD."periodo_id" AND NEW."estudiante_id"=OLD."estudiante_id" AND NEW."estado"=OLD."estado" AND NEW."fecha_ingreso"=OLD."fecha_ingreso" AND NEW."fecha_salida" IS NOT DISTINCT FROM OLD."fecha_salida" AND NEW."motivo_salida" IS NOT DISTINCT FROM OLD."motivo_salida" THEN
          RETURN NEW;
        END IF;
        IF EXISTS (SELECT 1 FROM ${s}."postulacion" WHERE "grupo_id"=v_grupo) THEN RAISE EXCEPTION 'la composición del grupo está cerrada por una postulación' USING ERRCODE='23514'; END IF;
        RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
      END $$
    `);
    await queryRunner.query(`CREATE TRIGGER "TRG_grupo_integrante_postulacion" BEFORE INSERT OR UPDATE OR DELETE ON ${s}."grupo_integrante" FOR EACH ROW EXECUTE FUNCTION ${s}."proteger_composicion_postulacion"()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."postulacion", ${s}."grupo_integrante", ${s}."invitacion" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(`SELECT count(*)::int AS total FROM ${s}."postulacion"`) as Array<{ total: number }>;
    if (Number(rows[0]?.total ?? 0) > 0) throw new Error('No se puede revertir la migración: postulacion contiene registros.');
    await queryRunner.query(`DROP TRIGGER "TRG_grupo_integrante_postulacion" ON ${s}."grupo_integrante"`);
    await queryRunner.query(`DROP TRIGGER "TRG_postulacion_validate" ON ${s}."postulacion"`);
    await queryRunner.query(`DROP FUNCTION ${s}."proteger_composicion_postulacion"()`);
    await queryRunner.query(`DROP FUNCTION ${s}."validar_postulacion_y_bloquear_periodo"()`);
    await queryRunner.query(`DROP TABLE ${s}."postulacion"`);
    await queryRunner.query(`DROP TYPE ${s}."postulacion_estado_enum"`);
  }
}
