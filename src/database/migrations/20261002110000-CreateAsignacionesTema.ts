import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema configurado para asignaciones no es válido.');
  return `"${schema}"`;
}

export class CreateAsignacionesTema20261002110000 implements MigrationInterface {
  name = 'CreateAsignacionesTema20261002110000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`CREATE TYPE ${s}."asignacion_tema_estado_enum" AS ENUM ('VIGENTE','ANULADA')`);
    await queryRunner.query(`CREATE TYPE ${s}."asignacion_tema_causa_enum" AS ENUM ('INCUMPLIMIENTO_CONDICION','OTRA')`);
    await queryRunner.query(`
      CREATE TABLE ${s}."asignacion_tema" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(), "tema_id" uuid NOT NULL, "periodo_id" uuid NOT NULL,
        "postulacion_id" uuid NOT NULL, "grupo_id" uuid NULL, "estudiante_id" uuid NULL,
        "aprobada_por_id" uuid NOT NULL, "estado" ${s}."asignacion_tema_estado_enum" NOT NULL DEFAULT 'VIGENTE',
        "fecha_asignacion" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, "motivo" text NOT NULL,
        "causa_anulacion" ${s}."asignacion_tema_causa_enum" NULL, "motivo_anulacion" text NULL,
        "anulada_por_id" uuid NULL, "fecha_anulacion" timestamptz NULL,
        CONSTRAINT "PK_asignacion_tema" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_asignacion_tema_postulacion" UNIQUE ("postulacion_id"),
        CONSTRAINT "FK_asignacion_tema_tema_periodo" FOREIGN KEY ("tema_id","periodo_id") REFERENCES ${s}."tema"("id","periodo_id") ON DELETE RESTRICT,
        CONSTRAINT "FK_asignacion_tema_postulacion_tema" FOREIGN KEY ("postulacion_id","tema_id") REFERENCES ${s}."postulacion"("id","tema_id") ON DELETE RESTRICT,
        CONSTRAINT "FK_asignacion_tema_postulacion_grupo" FOREIGN KEY ("postulacion_id","grupo_id") REFERENCES ${s}."postulacion"("id","grupo_id") ON DELETE RESTRICT,
        CONSTRAINT "FK_asignacion_tema_postulacion_estudiante" FOREIGN KEY ("postulacion_id","estudiante_id") REFERENCES ${s}."postulacion"("id","estudiante_id") ON DELETE RESTRICT,
        CONSTRAINT "FK_asignacion_tema_aprobada_por" FOREIGN KEY ("aprobada_por_id") REFERENCES ${s}."usuario"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_asignacion_tema_anulada_por" FOREIGN KEY ("anulada_por_id") REFERENCES ${s}."usuario"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_asignacion_tema_modalidad" CHECK (("grupo_id" IS NULL) <> ("estudiante_id" IS NULL)),
        CONSTRAINT "CHK_asignacion_tema_motivo" CHECK (length(btrim("motivo")) BETWEEN 1 AND 1000),
        CONSTRAINT "CHK_asignacion_tema_anulacion" CHECK (("estado"='VIGENTE' AND "causa_anulacion" IS NULL AND "motivo_anulacion" IS NULL AND "anulada_por_id" IS NULL AND "fecha_anulacion" IS NULL) OR ("estado"='ANULADA' AND "causa_anulacion" IS NOT NULL AND "motivo_anulacion" IS NOT NULL AND length(btrim("motivo_anulacion")) BETWEEN 1 AND 1000 AND "anulada_por_id" IS NOT NULL AND "fecha_anulacion" IS NOT NULL))
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_asignacion_tema_vigente_tema" ON ${s}."asignacion_tema" ("tema_id") WHERE "estado"='VIGENTE'`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_asignacion_tema_vigente_grupo" ON ${s}."asignacion_tema" ("grupo_id") WHERE "estado"='VIGENTE' AND "grupo_id" IS NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_asignacion_tema_vigente_estudiante" ON ${s}."asignacion_tema" ("estudiante_id") WHERE "estado"='VIGENTE' AND "estudiante_id" IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_asignacion_tema_periodo_fecha" ON ${s}."asignacion_tema" ("periodo_id","fecha_asignacion" DESC,"id" ASC)`);
    await queryRunner.query(`
      CREATE FUNCTION ${s}."proteger_asignacion_tema"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_postulacion record; v_participante uuid;
      BEGIN
        IF TG_OP='DELETE' THEN RAISE EXCEPTION 'las asignaciones forman parte del historial y no se eliminan' USING ERRCODE='23514'; END IF;
        IF TG_OP='UPDATE' THEN
          IF OLD."estado"<>'VIGENTE' OR NEW."estado"<>'ANULADA' OR
             (to_jsonb(NEW)-ARRAY['estado','causa_anulacion','motivo_anulacion','anulada_por_id','fecha_anulacion']) IS DISTINCT FROM
             (to_jsonb(OLD)-ARRAY['estado','causa_anulacion','motivo_anulacion','anulada_por_id','fecha_anulacion']) OR
             NEW."causa_anulacion" IS NULL OR NEW."anulada_por_id" IS NULL OR NEW."fecha_anulacion" IS NULL OR length(btrim(NEW."motivo_anulacion"))=0 THEN
            RAISE EXCEPTION 'solo se permite anular una asignación vigente conservando sus datos' USING ERRCODE='23514';
          END IF;
          RETURN NEW;
        END IF;
        IF NEW."estado"<>'VIGENTE' THEN RAISE EXCEPTION 'las asignaciones se crean vigentes' USING ERRCODE='23514'; END IF;
        SELECT p."tema_id",p."periodo_id",p."grupo_id",p."estudiante_id",p."estado"::text AS estado,p."num_integrantes"
          INTO v_postulacion FROM ${s}."postulacion" p WHERE p."id"=NEW."postulacion_id" FOR UPDATE;
        IF NOT FOUND OR v_postulacion."tema_id"<>NEW."tema_id" OR v_postulacion."periodo_id"<>NEW."periodo_id" OR
           v_postulacion."grupo_id" IS DISTINCT FROM NEW."grupo_id" OR v_postulacion."estudiante_id" IS DISTINCT FROM NEW."estudiante_id" OR
           v_postulacion.estado<>'ACEPTADA' THEN RAISE EXCEPTION 'la asignación debe corresponder a su postulación aceptada' USING ERRCODE='23514'; END IF;
        FOR v_participante IN
          SELECT e."id" FROM ${s}."estudiante" e WHERE e."id"=NEW."estudiante_id"
          UNION SELECT gi."estudiante_id" FROM ${s}."grupo_integrante" gi WHERE gi."grupo_id"=NEW."grupo_id" AND gi."estado"='ACTIVO'
          ORDER BY 1
        LOOP
          PERFORM pg_advisory_xact_lock(hashtextextended(v_participante::text, 7319));
          IF EXISTS (
            SELECT 1 FROM ${s}."asignacion_tema" a
            WHERE a."estado"='VIGENTE' AND a."id"<>NEW."id" AND (
              a."estudiante_id"=v_participante OR EXISTS (
                SELECT 1 FROM ${s}."grupo_integrante" other_member
                WHERE other_member."grupo_id"=a."grupo_id" AND other_member."estado"='ACTIVO' AND other_member."estudiante_id"=v_participante
              )
            )
          ) THEN RAISE EXCEPTION 'un participante ya tiene otra asignación vigente' USING ERRCODE='23505'; END IF;
        END LOOP;
        RETURN NEW;
      END $$
    `);
    await queryRunner.query(`CREATE TRIGGER "TRG_asignacion_tema_proteger" BEFORE INSERT OR UPDATE OR DELETE ON ${s}."asignacion_tema" FOR EACH ROW EXECUTE FUNCTION ${s}."proteger_asignacion_tema"()`);
    await queryRunner.query(`
      CREATE FUNCTION ${s}."validar_asignacion_tema_consistente"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_id uuid; v_estado text; v_postulacion_estado text; v_tema_estado text;
      BEGIN
        v_id := COALESCE((to_jsonb(NEW)->>'id')::uuid,(to_jsonb(OLD)->>'id')::uuid);
        SELECT a."estado"::text,p."estado"::text,t."estado"::text INTO v_estado,v_postulacion_estado,v_tema_estado
          FROM ${s}."asignacion_tema" a JOIN ${s}."postulacion" p ON p."id"=a."postulacion_id"
          JOIN ${s}."tema" t ON t."id"=a."tema_id" WHERE a."id"=v_id;
        IF NOT FOUND THEN RETURN NULL; END IF;
        IF v_estado='VIGENTE' AND (v_postulacion_estado<>'ACEPTADA' OR v_tema_estado<>'ASIGNADO') THEN
          RAISE EXCEPTION 'asignación vigente, postulación y tema deben mantener estados coherentes' USING ERRCODE='23514';
        END IF;
        IF v_estado='ANULADA' AND (v_postulacion_estado<>'ANULADA' OR v_tema_estado<>'PUBLICADO') THEN
          RAISE EXCEPTION 'anulación debe conservar estados coherentes' USING ERRCODE='23514';
        END IF;
        RETURN NULL;
      END $$
    `);
    await queryRunner.query(`CREATE CONSTRAINT TRIGGER "TRG_asignacion_tema_consistente" AFTER INSERT OR UPDATE ON ${s}."asignacion_tema" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${s}."validar_asignacion_tema_consistente"()`);
    await queryRunner.query(`
      CREATE FUNCTION ${s}."validar_estado_postulacion_asignacion"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."estado"='ACEPTADA' AND NOT EXISTS (SELECT 1 FROM ${s}."asignacion_tema" a WHERE a."postulacion_id"=NEW."id" AND a."estado"='VIGENTE') THEN
          RAISE EXCEPTION 'una postulación aceptada requiere asignación vigente' USING ERRCODE='23514';
        END IF;
        IF NEW."estado"='ANULADA' AND EXISTS (SELECT 1 FROM ${s}."asignacion_tema" a WHERE a."postulacion_id"=NEW."id" AND a."estado"='VIGENTE') THEN
          RAISE EXCEPTION 'una postulación anulada no puede conservar asignación vigente' USING ERRCODE='23514';
        END IF;
        RETURN NULL;
      END $$
    `);
    await queryRunner.query(`CREATE CONSTRAINT TRIGGER "TRG_postulacion_estado_asignacion" AFTER UPDATE ON ${s}."postulacion" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${s}."validar_estado_postulacion_asignacion"()`);
    await queryRunner.query(`
      CREATE FUNCTION ${s}."validar_estado_tema_asignacion"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."estado"='ASIGNADO' AND NOT EXISTS (SELECT 1 FROM ${s}."asignacion_tema" a WHERE a."tema_id"=NEW."id" AND a."estado"='VIGENTE') THEN
          RAISE EXCEPTION 'un tema ASIGNADO requiere asignación vigente' USING ERRCODE='23514';
        END IF;
        IF NEW."estado"='PUBLICADO' AND EXISTS (SELECT 1 FROM ${s}."asignacion_tema" a WHERE a."tema_id"=NEW."id" AND a."estado"='VIGENTE') THEN
          RAISE EXCEPTION 'un tema con asignación vigente no puede estar PUBLICADO' USING ERRCODE='23514';
        END IF;
        RETURN NULL;
      END $$
    `);
    await queryRunner.query(`CREATE CONSTRAINT TRIGGER "TRG_tema_estado_asignacion" AFTER UPDATE ON ${s}."tema" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${s}."validar_estado_tema_asignacion"()`);
    await queryRunner.query(`DROP TRIGGER "TRG_postulacion_validate" ON ${s}."postulacion"`);
    await queryRunner.query(`CREATE TRIGGER "TRG_postulacion_validate" BEFORE INSERT OR DELETE ON ${s}."postulacion" FOR EACH ROW EXECUTE FUNCTION ${s}."validar_postulacion_y_bloquear_periodo"()`);
    await queryRunner.query(`
      CREATE FUNCTION ${s}."validar_transicion_postulacion_asignacion"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP<>'UPDATE' OR NEW."id"<>OLD."id" OR NEW."tema_id"<>OLD."tema_id" OR NEW."periodo_id"<>OLD."periodo_id" OR
          NEW."grupo_id" IS DISTINCT FROM OLD."grupo_id" OR NEW."estudiante_id" IS DISTINCT FROM OLD."estudiante_id" OR
          NEW."num_integrantes"<>OLD."num_integrantes" OR NEW."registrada_por_id"<>OLD."registrada_por_id" OR NEW."fecha_postulacion"<>OLD."fecha_postulacion" THEN
          RAISE EXCEPTION 'no se pueden cambiar las referencias históricas de una postulación' USING ERRCODE='23514';
        END IF;
        IF (OLD."estado"='PENDIENTE' AND NEW."estado" IN ('CANCELADA','ACEPTADA','RECHAZADA')) OR
           (OLD."estado"='EN_CONFLICTO' AND NEW."estado"='RECHAZADA') OR
           (OLD."estado"='ACEPTADA' AND NEW."estado"='ANULADA') THEN
          IF NEW."observacion" IS NULL OR length(btrim(NEW."observacion"))=0 THEN RAISE EXCEPTION 'la transición requiere observación' USING ERRCODE='23514'; END IF;
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'transición de postulación no permitida' USING ERRCODE='23514';
      END $$
    `);
    await queryRunner.query(`CREATE TRIGGER "TRG_postulacion_transicion_asignacion" BEFORE UPDATE ON ${s}."postulacion" FOR EACH ROW EXECUTE FUNCTION ${s}."validar_transicion_postulacion_asignacion"()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."asignacion_tema", ${s}."postulacion", ${s}."tema" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(`SELECT count(*)::int AS total FROM ${s}."asignacion_tema"`) as Array<{ total: number }>;
    if (Number(rows[0]?.total ?? 0) > 0) throw new Error('No se puede revertir la migración: hay asignaciones de tema históricas.');
    const incompatible = await queryRunner.query(`SELECT (SELECT count(*) FROM ${s}."postulacion" WHERE "estado" IN ('ACEPTADA','ANULADA')) + (SELECT count(*) FROM ${s}."tema" WHERE "estado"='ASIGNADO') AS total`) as Array<{ total: string }>;
    if (Number(incompatible[0]?.total ?? 0) > 0) throw new Error('No se puede restaurar la protección anterior: hay postulaciones o temas en estados gestionados por esta migración.');
    await queryRunner.query(`DROP TRIGGER "TRG_postulacion_transicion_asignacion" ON ${s}."postulacion"`);
    await queryRunner.query(`DROP TRIGGER "TRG_postulacion_estado_asignacion" ON ${s}."postulacion"`);
    await queryRunner.query(`DROP TRIGGER "TRG_tema_estado_asignacion" ON ${s}."tema"`);
    await queryRunner.query(`DROP FUNCTION ${s}."validar_transicion_postulacion_asignacion"()`);
    await queryRunner.query(`DROP FUNCTION ${s}."validar_estado_postulacion_asignacion"()`);
    await queryRunner.query(`DROP FUNCTION ${s}."validar_estado_tema_asignacion"()`);
    await queryRunner.query(`DROP TRIGGER "TRG_postulacion_validate" ON ${s}."postulacion"`);
    await queryRunner.query(`CREATE TRIGGER "TRG_postulacion_validate" BEFORE INSERT OR UPDATE OR DELETE ON ${s}."postulacion" FOR EACH ROW EXECUTE FUNCTION ${s}."validar_postulacion_y_bloquear_periodo"()`);
    await queryRunner.query(`DROP TRIGGER "TRG_asignacion_tema_consistente" ON ${s}."asignacion_tema"`);
    await queryRunner.query(`DROP TRIGGER "TRG_asignacion_tema_proteger" ON ${s}."asignacion_tema"`);
    await queryRunner.query(`DROP FUNCTION ${s}."validar_asignacion_tema_consistente"()`);
    await queryRunner.query(`DROP FUNCTION ${s}."proteger_asignacion_tema"()`);
    await queryRunner.query(`DROP TABLE ${s}."asignacion_tema"`);
    await queryRunner.query(`DROP TYPE ${s}."asignacion_tema_causa_enum"`);
    await queryRunner.query(`DROP TYPE ${s}."asignacion_tema_estado_enum"`);
  }
}
