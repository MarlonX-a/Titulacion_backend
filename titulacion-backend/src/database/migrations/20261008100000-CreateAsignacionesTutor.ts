import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema configurado para asignaciones de tutor no es válido.');
  return `"${schema}"`;
}

export class CreateAsignacionesTutor20261008100000 implements MigrationInterface {
  name = 'CreateAsignacionesTutor20261008100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`CREATE TYPE ${s}."asignacion_tutor_tipo_enum" AS ENUM ('PROPUESTO_CONFIRMADO','ASIGNADO_DIRECTO')`);
    await queryRunner.query(`CREATE TYPE ${s}."asignacion_tutor_estado_enum" AS ENUM ('VIGENTE','REEMPLAZADA','ANULADA')`);
    await queryRunner.query(`
      CREATE TABLE ${s}."asignacion_tutor" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "asignacion_tema_id" uuid NOT NULL,
        "docente_id" uuid NOT NULL,
        "tutor_propuesto_id" uuid NULL,
        "tipo" ${s}."asignacion_tutor_tipo_enum" NOT NULL,
        "estado" ${s}."asignacion_tutor_estado_enum" NOT NULL DEFAULT 'VIGENTE',
        "asignada_por_id" uuid NOT NULL,
        "fecha_asignacion" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "fecha_fin" timestamptz NULL,
        "motivo_cambio" text NULL,
        CONSTRAINT "PK_asignacion_tutor" PRIMARY KEY ("id"),
        CONSTRAINT "FK_asignacion_tutor_trabajo" FOREIGN KEY ("asignacion_tema_id") REFERENCES ${s}."asignacion_tema"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_asignacion_tutor_docente" FOREIGN KEY ("docente_id") REFERENCES ${s}."docente"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_asignacion_tutor_propuesta_docente" FOREIGN KEY ("tutor_propuesto_id", "docente_id") REFERENCES ${s}."tutor_propuesto"("id", "docente_id") ON DELETE RESTRICT,
        CONSTRAINT "FK_asignacion_tutor_responsable" FOREIGN KEY ("asignada_por_id") REFERENCES ${s}."usuario"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_asignacion_tutor_tipo_propuesta" CHECK (("tipo"='PROPUESTO_CONFIRMADO' AND "tutor_propuesto_id" IS NOT NULL) OR ("tipo"='ASIGNADO_DIRECTO' AND "tutor_propuesto_id" IS NULL)),
        CONSTRAINT "CHK_asignacion_tutor_estado_fecha_fin" CHECK (("estado"='VIGENTE' AND "fecha_fin" IS NULL AND "motivo_cambio" IS NULL) OR ("estado" IN ('REEMPLAZADA','ANULADA') AND "fecha_fin" IS NOT NULL AND "motivo_cambio" IS NOT NULL AND length(btrim("motivo_cambio")) BETWEEN 1 AND 1000)),
        CONSTRAINT "CHK_asignacion_tutor_cronologia" CHECK ("fecha_fin" IS NULL OR "fecha_fin" >= "fecha_asignacion")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_asignacion_tutor_vigente_trabajo" ON ${s}."asignacion_tutor" ("asignacion_tema_id") WHERE "estado"='VIGENTE'`);
    await queryRunner.query(`CREATE INDEX "IDX_asignacion_tutor_docente_estado" ON ${s}."asignacion_tutor" ("docente_id","estado","fecha_asignacion" DESC,"id" ASC)`);
    await queryRunner.query(`
      CREATE FUNCTION ${s}."proteger_asignacion_tutor"() RETURNS trigger LANGUAGE plpgsql AS $$
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
            AND (c."docente_id"=NEW."docente_id" OR c."docente_id" IS NULL)
          ORDER BY (c."docente_id" IS NULL) ASC LIMIT 1;
        IF NOT FOUND THEN RAISE EXCEPTION 'falta configuración de carga tutorial aplicable' USING ERRCODE='23514'; END IF;
        SELECT count(*)::int INTO v_count FROM ${s}."asignacion_tutor" current_tutor
          JOIN ${s}."asignacion_tema" current_work ON current_work."id"=current_tutor."asignacion_tema_id"
          WHERE current_work."periodo_id"=v_periodo AND current_work."estado"='VIGENTE'
            AND current_tutor."docente_id"=NEW."docente_id" AND current_tutor."estado"='VIGENTE';
        IF v_block AND v_count+1>v_max THEN RAISE EXCEPTION 'el docente superaría el máximo de carga configurado' USING ERRCODE='23514'; END IF;
        RETURN NEW;
      END $$
    `);
    await queryRunner.query(`CREATE TRIGGER "TRG_asignacion_tutor_proteger" BEFORE INSERT OR UPDATE OR DELETE ON ${s}."asignacion_tutor" FOR EACH ROW EXECUTE FUNCTION ${s}."proteger_asignacion_tutor"()`);
    await queryRunner.query(`
      CREATE FUNCTION ${s}."validar_tutor_vs_trabajo"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_id uuid; v_tutor_estado text; v_trabajo_estado text; v_tema_estado text;
      BEGIN
        IF TG_TABLE_NAME='asignacion_tema' THEN
          v_id := COALESCE((to_jsonb(NEW)->>'id')::uuid,(to_jsonb(OLD)->>'id')::uuid);
        ELSE
          v_id := COALESCE((to_jsonb(NEW)->>'asignacion_tema_id')::uuid,(to_jsonb(OLD)->>'asignacion_tema_id')::uuid);
        END IF;
        SELECT tutor."estado"::text,trabajo."estado"::text,tema."estado"::text
          INTO v_tutor_estado,v_trabajo_estado, v_tema_estado
          FROM ${s}."asignacion_tema" trabajo JOIN ${s}."tema" tema ON tema."id"=trabajo."tema_id"
          LEFT JOIN ${s}."asignacion_tutor" tutor ON tutor."asignacion_tema_id"=trabajo."id" AND tutor."estado"='VIGENTE'
          WHERE trabajo."id"=v_id;
        IF NOT FOUND THEN RETURN NULL; END IF;
        IF v_tutor_estado='VIGENTE' AND (v_trabajo_estado<>'VIGENTE' OR v_tema_estado<>'ASIGNADO') THEN
          RAISE EXCEPTION 'un tutor vigente requiere trabajo vigente y tema ASIGNADO' USING ERRCODE='23514';
        END IF;
        IF v_trabajo_estado='ANULADA' AND v_tutor_estado='VIGENTE' THEN
          RAISE EXCEPTION 'un trabajo anulado no puede conservar tutor vigente' USING ERRCODE='23514';
        END IF;
        RETURN NULL;
      END $$
    `);
    await queryRunner.query(`CREATE CONSTRAINT TRIGGER "TRG_tutor_trabajo_consistente" AFTER INSERT OR UPDATE ON ${s}."asignacion_tutor" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${s}."validar_tutor_vs_trabajo"()`);
    await queryRunner.query(`CREATE CONSTRAINT TRIGGER "TRG_trabajo_tutor_consistente" AFTER UPDATE ON ${s}."asignacion_tema" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${s}."validar_tutor_vs_trabajo"()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."asignacion_tutor" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(`SELECT count(*)::int AS total FROM ${s}."asignacion_tutor"`) as Array<{ total: number }>;
    if (Number(rows[0]?.total ?? 0) > 0) throw new Error('No se puede revertir la migración: asignacion_tutor contiene historial.');
    await queryRunner.query(`DROP TRIGGER "TRG_trabajo_tutor_consistente" ON ${s}."asignacion_tema"`);
    await queryRunner.query(`DROP TRIGGER "TRG_tutor_trabajo_consistente" ON ${s}."asignacion_tutor"`);
    await queryRunner.query(`DROP TRIGGER "TRG_asignacion_tutor_proteger" ON ${s}."asignacion_tutor"`);
    await queryRunner.query(`DROP FUNCTION ${s}."validar_tutor_vs_trabajo"()`);
    await queryRunner.query(`DROP FUNCTION ${s}."proteger_asignacion_tutor"()`);
    await queryRunner.query(`DROP TABLE ${s}."asignacion_tutor"`);
    await queryRunner.query(`DROP TYPE ${s}."asignacion_tutor_estado_enum"`);
    await queryRunner.query(`DROP TYPE ${s}."asignacion_tutor_tipo_enum"`);
  }
}
