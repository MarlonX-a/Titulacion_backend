import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema configurado para asignaciones no es válido.');
  return `"${schema}"`;
}

export class StrengthenAsignacionTemaIntegrity20261002120000 implements MigrationInterface {
  name = 'StrengthenAsignacionTemaIntegrity20261002120000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`DROP TRIGGER "TRG_asignacion_tema_proteger" ON ${s}."asignacion_tema"`);
    await queryRunner.query(`DROP TRIGGER "TRG_tema_estado_asignacion" ON ${s}."tema"`);
    await queryRunner.query(`ALTER FUNCTION ${s}."proteger_asignacion_tema"() RENAME TO "proteger_asignacion_tema_v1"`);
    await queryRunner.query(`ALTER FUNCTION ${s}."validar_estado_tema_asignacion"() RENAME TO "validar_estado_tema_asignacion_v1"`);
    await queryRunner.query(`
      CREATE FUNCTION ${s}."proteger_asignacion_tema"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_post record; v_topic record; v_group record; v_count integer; v_representatives integer; v_participant uuid;
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
        SELECT t."estado"::text AS estado,t."min_integrantes",t."max_integrantes" INTO v_topic
          FROM ${s}."tema" t WHERE t."id"=NEW."tema_id" AND t."periodo_id"=NEW."periodo_id" FOR UPDATE;
        IF NOT FOUND OR v_topic.estado<>'PUBLICADO' THEN
          RAISE EXCEPTION 'tema o rango de integrantes incompatible con la asignación' USING ERRCODE='23514';
        END IF;
        SELECT p."tema_id",p."periodo_id",p."grupo_id",p."estudiante_id",p."estado"::text AS estado,p."num_integrantes"
          INTO v_post FROM ${s}."postulacion" p WHERE p."id"=NEW."postulacion_id" FOR UPDATE;
        IF NOT FOUND OR v_post."tema_id"<>NEW."tema_id" OR v_post."periodo_id"<>NEW."periodo_id" OR
           v_post."grupo_id" IS DISTINCT FROM NEW."grupo_id" OR v_post."estudiante_id" IS DISTINCT FROM NEW."estudiante_id" OR v_post.estado<>'ACEPTADA' OR
           v_post."num_integrantes"<v_topic."min_integrantes" OR v_post."num_integrantes">v_topic."max_integrantes" THEN
          RAISE EXCEPTION 'la asignación debe corresponder a su postulación aceptada y rango del tema' USING ERRCODE='23514';
        END IF;
        IF NEW."grupo_id" IS NOT NULL THEN
          SELECT g."estado"::text AS estado INTO v_group FROM ${s}."grupo" g WHERE g."id"=NEW."grupo_id" AND g."periodo_id"=NEW."periodo_id" FOR UPDATE;
          PERFORM 1 FROM ${s}."grupo_integrante" gi WHERE gi."grupo_id"=NEW."grupo_id" AND gi."periodo_id"=NEW."periodo_id" ORDER BY gi."estudiante_id" FOR UPDATE;
          SELECT count(*) FILTER (WHERE gi."estado"='ACTIVO'),count(*) FILTER (WHERE gi."estado"='ACTIVO' AND gi."rol_en_grupo"='REPRESENTANTE')
            INTO v_count,v_representatives FROM ${s}."grupo_integrante" gi WHERE gi."grupo_id"=NEW."grupo_id" AND gi."periodo_id"=NEW."periodo_id";
          IF v_group.estado IS DISTINCT FROM 'ACTIVO' OR v_count<2 OR v_count<>v_post."num_integrantes" OR v_representatives<>1 THEN
            RAISE EXCEPTION 'la composición y representación del grupo no coincide con la postulación' USING ERRCODE='23514';
          END IF;
        ELSIF NEW."estudiante_id" IS NULL OR v_post."num_integrantes"<>1 THEN
          RAISE EXCEPTION 'la modalidad individual requiere exactamente un estudiante' USING ERRCODE='23514';
        END IF;
        FOR v_participant IN
          SELECT e."id" FROM ${s}."estudiante" e WHERE e."id"=NEW."estudiante_id"
          UNION SELECT gi."estudiante_id" FROM ${s}."grupo_integrante" gi WHERE gi."grupo_id"=NEW."grupo_id" AND gi."estado"='ACTIVO'
          ORDER BY 1
        LOOP
          PERFORM pg_advisory_xact_lock(hashtextextended(v_participant::text, 7319));
          IF EXISTS (
            SELECT 1 FROM ${s}."asignacion_tema" a
            WHERE a."estado"='VIGENTE' AND a."id"<>NEW."id" AND (
              a."estudiante_id"=v_participant OR EXISTS (
                SELECT 1 FROM ${s}."grupo_integrante" other_member
                WHERE other_member."grupo_id"=a."grupo_id" AND other_member."estado"='ACTIVO' AND other_member."estudiante_id"=v_participant
              )
            )
          ) THEN RAISE EXCEPTION 'un participante ya tiene otra asignación vigente' USING ERRCODE='23505'; END IF;
        END LOOP;
        RETURN NEW;
      END $$
    `);
    await queryRunner.query(`CREATE TRIGGER "TRG_asignacion_tema_proteger" BEFORE INSERT OR UPDATE OR DELETE ON ${s}."asignacion_tema" FOR EACH ROW EXECUTE FUNCTION ${s}."proteger_asignacion_tema"()`);
    await queryRunner.query(`
      CREATE FUNCTION ${s}."validar_estado_tema_asignacion"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_tiene_vigente boolean;
      BEGIN
        SELECT EXISTS(SELECT 1 FROM ${s}."asignacion_tema" a WHERE a."tema_id"=NEW."id" AND a."estado"='VIGENTE') INTO v_tiene_vigente;
        IF v_tiene_vigente AND NEW."estado"<>'ASIGNADO' THEN
          RAISE EXCEPTION 'un tema con asignación vigente debe permanecer ASIGNADO' USING ERRCODE='23514';
        END IF;
        IF NEW."estado"='ASIGNADO' AND NOT v_tiene_vigente THEN
          RAISE EXCEPTION 'un tema ASIGNADO requiere una asignación vigente' USING ERRCODE='23514';
        END IF;
        RETURN NULL;
      END $$
    `);
    await queryRunner.query(`CREATE CONSTRAINT TRIGGER "TRG_tema_estado_asignacion" AFTER UPDATE ON ${s}."tema" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${s}."validar_estado_tema_asignacion"()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`DROP TRIGGER "TRG_asignacion_tema_proteger" ON ${s}."asignacion_tema"`);
    await queryRunner.query(`DROP TRIGGER "TRG_tema_estado_asignacion" ON ${s}."tema"`);
    await queryRunner.query(`DROP FUNCTION ${s}."proteger_asignacion_tema"()`);
    await queryRunner.query(`DROP FUNCTION ${s}."validar_estado_tema_asignacion"()`);
    await queryRunner.query(`ALTER FUNCTION ${s}."proteger_asignacion_tema_v1"() RENAME TO "proteger_asignacion_tema"`);
    await queryRunner.query(`ALTER FUNCTION ${s}."validar_estado_tema_asignacion_v1"() RENAME TO "validar_estado_tema_asignacion"`);
    await queryRunner.query(`CREATE TRIGGER "TRG_asignacion_tema_proteger" BEFORE INSERT OR UPDATE OR DELETE ON ${s}."asignacion_tema" FOR EACH ROW EXECUTE FUNCTION ${s}."proteger_asignacion_tema"()`);
    await queryRunner.query(`CREATE CONSTRAINT TRIGGER "TRG_tema_estado_asignacion" AFTER UPDATE ON ${s}."tema" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${s}."validar_estado_tema_asignacion"()`);
  }
}
