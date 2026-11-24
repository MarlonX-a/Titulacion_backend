import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema configurado para los equipos administrativos no es válido.');
  return `"${schema}"`;
}

const TIPOS_TUTOR_ANTES = ['PROPUESTO_CONFIRMADO', 'ASIGNADO_DIRECTO'];
const TIPOS_TUTOR = [...TIPOS_TUTOR_ANTES, 'CANDIDATO_CONFIRMADO'];

/** Rebuilds `asignacion_tutor_tipo_enum` (ADD VALUE could not be used by the CHECK of this same transaction). */
async function reconstruirTipoTutor(queryRunner: QueryRunner, s: string, valores: string[]): Promise<void> {
  await queryRunner.query(`ALTER TYPE ${s}."asignacion_tutor_tipo_enum" RENAME TO "asignacion_tutor_tipo_enum_old"`);
  await queryRunner.query(`CREATE TYPE ${s}."asignacion_tutor_tipo_enum" AS ENUM (${valores.map((v) => `'${v}'`).join(',')})`);
  await queryRunner.query(`ALTER TABLE ${s}."asignacion_tutor" ALTER COLUMN "tipo" TYPE ${s}."asignacion_tutor_tipo_enum" USING "tipo"::text::${s}."asignacion_tutor_tipo_enum"`);
  await queryRunner.query(`DROP TYPE ${s}."asignacion_tutor_tipo_enum_old"`);
}

/**
 * `proteger_asignacion_tema`. Without `admin` it is the reservation version of
 * 20261115100000 (every assignment comes from an accepted application). With `admin`, an
 * assignment with `origen = 'ADMIN'` has no application: the topic must be PUBLICADO, the
 * composition (group ACTIVO with one representative, or one student) must fit the topic type and
 * every participant must be HABILITADO with situation PENDIENTE or ADMITIDO in the period.
 * The global "one VIGENTE assignment per participant" loop applies to both origins.
 */
function protegerAsignacionSql(s: string, admin: boolean): string {
  const postulacion = `
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
        END IF;`;
  const administrativa = `
        IF NEW."origen"='ADMIN' THEN
          IF v_topic.estado<>'PUBLICADO' OR NEW."postulacion_id" IS NOT NULL THEN
            RAISE EXCEPTION 'una asignación administrativa requiere un tema PUBLICADO y no proviene de una postulación' USING ERRCODE='23514';
          END IF;
          IF NEW."grupo_id" IS NOT NULL THEN
            SELECT g."estado"::text AS estado INTO v_group FROM ${s}."grupo" g WHERE g."id"=NEW."grupo_id" AND g."periodo_id"=NEW."periodo_id" FOR UPDATE;
            PERFORM 1 FROM ${s}."grupo_integrante" gi WHERE gi."grupo_id"=NEW."grupo_id" AND gi."periodo_id"=NEW."periodo_id" ORDER BY gi."estudiante_id" FOR UPDATE;
            SELECT count(*) FILTER (WHERE gi."estado"='ACTIVO'),count(*) FILTER (WHERE gi."estado"='ACTIVO' AND gi."rol_en_grupo"='REPRESENTANTE')
              INTO v_count,v_representatives FROM ${s}."grupo_integrante" gi WHERE gi."grupo_id"=NEW."grupo_id" AND gi."periodo_id"=NEW."periodo_id";
            IF v_group.estado IS DISTINCT FROM 'ACTIVO' OR v_count<2 OR v_representatives<>1 OR v_count<v_topic."min_integrantes" OR v_count>v_topic."max_integrantes" THEN
              RAISE EXCEPTION 'la composición del grupo no corresponde al tipo del tema' USING ERRCODE='23514';
            END IF;
          ELSIF NEW."estudiante_id" IS NULL OR v_topic."min_integrantes"<>1 THEN
            RAISE EXCEPTION 'la modalidad individual requiere exactamente un estudiante y un tema individual' USING ERRCODE='23514';
          END IF;
          IF EXISTS (
            SELECT 1 FROM (
              SELECT NEW."estudiante_id" AS id WHERE NEW."estudiante_id" IS NOT NULL
              UNION SELECT gi."estudiante_id" FROM ${s}."grupo_integrante" gi WHERE gi."grupo_id"=NEW."grupo_id" AND gi."estado"='ACTIVO'
            ) participante
            WHERE NOT EXISTS (
              SELECT 1 FROM ${s}."estudiante_habilitado" h WHERE h."periodo_id"=NEW."periodo_id" AND h."estudiante_id"=participante.id
                AND h."estado"='HABILITADO' AND h."situacion_ingreso" IN ('PENDIENTE','ADMITIDO')
            )
          ) THEN RAISE EXCEPTION 'los participantes deben estar habilitados en el período' USING ERRCODE='23514'; END IF;
        ELSE${postulacion}
        END IF;`;
  return `
      CREATE OR REPLACE FUNCTION ${s}."proteger_asignacion_tema"() RETURNS trigger LANGUAGE plpgsql AS $$
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
        SELECT t."estado"::text AS estado,
               CASE t."tipo" WHEN 'INDIVIDUAL' THEN 1 WHEN 'PAREJA' THEN 2 ELSE 3 END AS min_integrantes,
               CASE t."tipo" WHEN 'INDIVIDUAL' THEN 1 WHEN 'PAREJA' THEN 2 ELSE p."max_integrantes_default" END AS max_integrantes
          INTO v_topic FROM ${s}."tema" t JOIN ${s}."periodo_titulacion" p ON p."id"=NEW."periodo_id"
          WHERE t."id"=NEW."tema_id" FOR UPDATE OF t;
        IF NOT FOUND OR v_topic.estado NOT IN ('PUBLICADO','RESERVADO') THEN
          RAISE EXCEPTION 'tema o rango de integrantes incompatible con la asignación' USING ERRCODE='23514';
        END IF;${admin ? administrativa : postulacion}
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
      END $$`;
}

/**
 * Deferred coherence between assignment, application and topic (20261002110000). With `admin`,
 * an ADMIN assignment has no application: only the topic state is checked.
 */
function consistenciaAsignacionSql(s: string, admin: boolean): string {
  if (!admin) {
    return `
      CREATE OR REPLACE FUNCTION ${s}."validar_asignacion_tema_consistente"() RETURNS trigger LANGUAGE plpgsql AS $$
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
      END $$`;
  }
  return `
      CREATE OR REPLACE FUNCTION ${s}."validar_asignacion_tema_consistente"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_id uuid; v_estado text; v_origen text; v_postulacion_estado text; v_tema_estado text;
      BEGIN
        v_id := COALESCE((to_jsonb(NEW)->>'id')::uuid,(to_jsonb(OLD)->>'id')::uuid);
        SELECT a."estado"::text,a."origen"::text,p."estado"::text,t."estado"::text INTO v_estado,v_origen,v_postulacion_estado,v_tema_estado
          FROM ${s}."asignacion_tema" a LEFT JOIN ${s}."postulacion" p ON p."id"=a."postulacion_id"
          JOIN ${s}."tema" t ON t."id"=a."tema_id" WHERE a."id"=v_id;
        IF NOT FOUND THEN RETURN NULL; END IF;
        IF v_estado='VIGENTE' AND (v_tema_estado<>'ASIGNADO' OR (v_origen='POSTULACION' AND v_postulacion_estado IS DISTINCT FROM 'ACEPTADA')) THEN
          RAISE EXCEPTION 'asignación vigente, postulación y tema deben mantener estados coherentes' USING ERRCODE='23514';
        END IF;
        IF v_estado='ANULADA' AND (v_tema_estado<>'PUBLICADO' OR (v_origen='POSTULACION' AND v_postulacion_estado IS DISTINCT FROM 'ANULADA')) THEN
          RAISE EXCEPTION 'anulación debe conservar estados coherentes' USING ERRCODE='23514';
        END IF;
        RETURN NULL;
      END $$`;
}

/**
 * `proteger_asignacion_tutor` (version of 20261020100000, only active load limits). With `admin`
 * the work no longer needs an application: ADMIN works have none and their candidates are
 * referenced through `candidato_tutor_id` (composite FK to the same work and teacher).
 */
function protegerTutorSql(s: string, admin: boolean): string {
  const trabajo = admin
    ? `SELECT a."periodo_id",a."estado"::text,t."estado"::text,a."postulacion_id",a."origen"::text
          INTO v_periodo,v_estado,v_tema_estado,v_postulacion,v_origen
          FROM ${s}."asignacion_tema" a JOIN ${s}."tema" t ON t."id"=a."tema_id"
          WHERE a."id"=NEW."asignacion_tema_id" FOR UPDATE OF a,t;
        IF NOT FOUND OR v_estado<>'VIGENTE' OR v_tema_estado<>'ASIGNADO' OR (v_origen='POSTULACION' AND v_postulacion IS NULL) THEN`
    : `SELECT a."periodo_id",a."estado"::text,t."estado"::text,p."id"
          INTO v_periodo,v_estado,v_tema_estado,v_postulacion
          FROM ${s}."asignacion_tema" a JOIN ${s}."tema" t ON t."id"=a."tema_id"
          JOIN ${s}."postulacion" p ON p."id"=a."postulacion_id"
          WHERE a."id"=NEW."asignacion_tema_id" FOR UPDATE OF a,t;
        IF NOT FOUND OR v_estado<>'VIGENTE' OR v_tema_estado<>'ASIGNADO' OR v_postulacion IS NULL THEN`;
  return `
      CREATE OR REPLACE FUNCTION ${s}."proteger_asignacion_tutor"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_periodo uuid; v_estado text; v_tema_estado text; v_postulacion uuid;${admin ? ' v_origen text;' : ''}
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
        ${trabajo}
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
 * `proteger_composicion_postulacion` (reservation version of 20261115100000). With `admin`, a
 * VIGENTE assignment of the group closes membership changes the way an application does (ADMIN
 * groups have no application). An ANULADA assignment no longer closes those changes, so annulling
 * an admin team can retire every member and dissolve the group in the same transaction. Inserts
 * stay closed by any assignment row, so that dissolved group cannot gain members again. A student
 * with an individual VIGENTE assignment cannot join a group. The NO_ADMITIDO withdrawal exception
 * and the postulación close (any application row, regardless of assignment state) are unchanged.
 */
function composicionSql(s: string, admin: boolean): string {
  const altaAdmin = admin
    ? `
          IF EXISTS (SELECT 1 FROM ${s}."asignacion_tema" WHERE "grupo_id"=NEW."grupo_id") THEN RAISE EXCEPTION 'la composición del grupo está cerrada por una asignación' USING ERRCODE='23514'; END IF;
          IF EXISTS (SELECT 1 FROM ${s}."asignacion_tema" WHERE "estudiante_id"=NEW."estudiante_id" AND "estado"='VIGENTE') THEN RAISE EXCEPTION 'estudiante con asignación individual vigente' USING ERRCODE='23505'; END IF;`
    : '';
  const cerrada = admin
    ? `(EXISTS (SELECT 1 FROM ${s}."postulacion" WHERE "grupo_id"=v_grupo) OR EXISTS (SELECT 1 FROM ${s}."asignacion_tema" WHERE "grupo_id"=v_grupo AND "estado"='VIGENTE'))`
    : `EXISTS (SELECT 1 FROM ${s}."postulacion" WHERE "grupo_id"=v_grupo)`;
  return `
      CREATE OR REPLACE FUNCTION ${s}."proteger_composicion_postulacion"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_periodo uuid; v_grupo uuid; v_individual boolean;
      BEGIN
        v_periodo := CASE WHEN TG_OP='DELETE' THEN OLD."periodo_id" ELSE NEW."periodo_id" END;
        v_grupo := CASE WHEN TG_OP='DELETE' THEN OLD."grupo_id" ELSE NEW."grupo_id" END;
        PERFORM 1 FROM ${s}."periodo_titulacion" WHERE "id"=v_periodo FOR UPDATE;
        IF TG_OP='INSERT' THEN
          IF EXISTS (SELECT 1 FROM ${s}."postulacion" WHERE "grupo_id"=NEW."grupo_id") THEN RAISE EXCEPTION 'la composición del grupo está cerrada por una postulación' USING ERRCODE='23514'; END IF;${altaAdmin}
          SELECT EXISTS(SELECT 1 FROM ${s}."postulacion" WHERE "periodo_id"=NEW."periodo_id" AND "estudiante_id"=NEW."estudiante_id" AND "estado" IN ('PENDIENTE_CONFIRMACION','PENDIENTE','EN_CONFLICTO','ACEPTADA')) INTO v_individual;
          IF v_individual THEN RAISE EXCEPTION 'estudiante con postulación individual activa' USING ERRCODE='23505'; END IF;
          RETURN NEW;
        END IF;
        IF TG_OP='UPDATE' AND NEW."grupo_id"=OLD."grupo_id" AND NEW."periodo_id"=OLD."periodo_id" AND NEW."estudiante_id"=OLD."estudiante_id" AND NEW."estado"=OLD."estado" AND NEW."fecha_ingreso"=OLD."fecha_ingreso" AND NEW."fecha_salida" IS NOT DISTINCT FROM OLD."fecha_salida" AND NEW."motivo_salida" IS NOT DISTINCT FROM OLD."motivo_salida" THEN
          RETURN NEW;
        END IF;
        IF TG_OP='UPDATE' AND NEW."grupo_id"=OLD."grupo_id" AND NEW."periodo_id"=OLD."periodo_id" AND NEW."estudiante_id"=OLD."estudiante_id" AND NEW."fecha_ingreso"=OLD."fecha_ingreso" AND OLD."estado"='ACTIVO' AND NEW."estado"='RETIRADO' AND NEW."fecha_salida" IS NOT NULL
          AND EXISTS (SELECT 1 FROM ${s}."estudiante_habilitado" h WHERE h."periodo_id"=NEW."periodo_id" AND h."estudiante_id"=NEW."estudiante_id" AND h."situacion_ingreso"='NO_ADMITIDO') THEN
          RETURN NEW;
        END IF;
        IF ${cerrada} THEN RAISE EXCEPTION 'la composición del grupo está cerrada por una postulación' USING ERRCODE='23514'; END IF;
        RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
      END $$`;
}

/** Candidates are history: inserted only for a VIGENTE ADMIN work of a non-archived period and an eligible teacher. */
function protegerCandidatoSql(s: string): string {
  return `
      CREATE FUNCTION ${s}."proteger_candidato_tutor"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_origen text; v_estado text; v_periodo_estado text; v_activo text; v_rol text; v_habilitado boolean;
      BEGIN
        IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'los candidatos a tutor son históricos y no se modifican ni eliminan' USING ERRCODE='23514'; END IF;
        SELECT a."origen"::text,a."estado"::text,p."estado"::text INTO v_origen,v_estado,v_periodo_estado
          FROM ${s}."asignacion_tema" a JOIN ${s}."periodo_titulacion" p ON p."id"=a."periodo_id"
          WHERE a."id"=NEW."asignacion_tema_id" FOR SHARE OF a;
        IF NOT FOUND OR v_origen<>'ADMIN' OR v_estado<>'VIGENTE' OR v_periodo_estado='ARCHIVADO' THEN
          RAISE EXCEPTION 'los candidatos a tutor solo se registran en asignaciones administrativas vigentes' USING ERRCODE='23514';
        END IF;
        SELECT u."estado"::text,u."rol"::text,d."habilitado_tutoria" INTO v_activo,v_rol,v_habilitado
          FROM ${s}."docente" d JOIN ${s}."usuario" u ON u."id"=d."usuario_id"
          WHERE d."id"=NEW."docente_id" FOR SHARE OF d,u;
        IF NOT FOUND OR v_activo<>'ACTIVO' OR v_rol<>'DOCENTE' OR v_habilitado IS DISTINCT FROM true THEN
          RAISE EXCEPTION 'el docente no está habilitado para tutoría' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$`;
}

const CHECK_TIPO_ANTES = `("tipo"='PROPUESTO_CONFIRMADO' AND "tutor_propuesto_id" IS NOT NULL) OR ("tipo"='ASIGNADO_DIRECTO' AND "tutor_propuesto_id" IS NULL)`;
const CHECK_TIPO = `("tipo"='PROPUESTO_CONFIRMADO' AND "tutor_propuesto_id" IS NOT NULL AND "candidato_tutor_id" IS NULL) OR ("tipo"='ASIGNADO_DIRECTO' AND "tutor_propuesto_id" IS NULL AND "candidato_tutor_id" IS NULL) OR ("tipo"='CANDIDATO_CONFIRMADO' AND "tutor_propuesto_id" IS NULL AND "candidato_tutor_id" IS NOT NULL)`;

/**
 * Admin team builder (design 2026-11-23, piece A). ADMIN creates a team (group or individual),
 * assigns a topic without an application and registers 1..10 ordered tutor candidates:
 *
 * - `asignacion_tema.origen` (POSTULACION | ADMIN); `postulacion_id` becomes optional and
 *   `CHK_asignacion_tema_origen` ties it to the origin, so existing applications keep every rule.
 * - `candidato_tutor`: ordered candidates per ADMIN work (unique teacher and priority per work).
 *   It does not reuse `tutor_propuesto`, which belongs to an application.
 * - `asignacion_tutor.tipo` gains CANDIDATO_CONFIRMADO with `candidato_tutor_id`, referenced by a
 *   composite FK to the same work and teacher.
 * - The protection triggers accept ADMIN works and close the composition of ADMIN groups.
 */
export class EquiposAdmin20261123120000 implements MigrationInterface {
  name = 'EquiposAdmin20261123120000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."asignacion_tema", ${s}."asignacion_tutor", ${s}."grupo_integrante" IN ACCESS EXCLUSIVE MODE`);
    await queryRunner.query(`CREATE TYPE ${s}."asignacion_tema_origen_enum" AS ENUM ('POSTULACION','ADMIN')`);
    await queryRunner.query(`ALTER TABLE ${s}."asignacion_tema" ADD COLUMN "origen" ${s}."asignacion_tema_origen_enum" NOT NULL DEFAULT 'POSTULACION'`);
    await queryRunner.query(`ALTER TABLE ${s}."asignacion_tema" ALTER COLUMN "postulacion_id" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE ${s}."asignacion_tema" ADD CONSTRAINT "CHK_asignacion_tema_origen" CHECK (("origen"='POSTULACION' AND "postulacion_id" IS NOT NULL) OR ("origen"='ADMIN' AND "postulacion_id" IS NULL))`);
    await queryRunner.query(protegerAsignacionSql(s, true));
    await queryRunner.query(consistenciaAsignacionSql(s, true));

    await queryRunner.query(`
      CREATE TABLE ${s}."candidato_tutor" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "asignacion_tema_id" uuid NOT NULL,
        "docente_id" uuid NOT NULL,
        "prioridad" smallint NOT NULL,
        "registrado_por_id" uuid NOT NULL,
        "creado_en" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_candidato_tutor" PRIMARY KEY ("id"),
        CONSTRAINT "FK_candidato_tutor_trabajo" FOREIGN KEY ("asignacion_tema_id") REFERENCES ${s}."asignacion_tema"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_candidato_tutor_docente" FOREIGN KEY ("docente_id") REFERENCES ${s}."docente"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_candidato_tutor_responsable" FOREIGN KEY ("registrado_por_id") REFERENCES ${s}."usuario"("id") ON DELETE RESTRICT,
        CONSTRAINT "UQ_candidato_tutor_trabajo_docente" UNIQUE ("asignacion_tema_id","docente_id"),
        CONSTRAINT "UQ_candidato_tutor_trabajo_prioridad" UNIQUE ("asignacion_tema_id","prioridad"),
        CONSTRAINT "UQ_candidato_tutor_referencia" UNIQUE ("id","asignacion_tema_id","docente_id"),
        CONSTRAINT "CHK_candidato_tutor_prioridad" CHECK ("prioridad" BETWEEN 1 AND 10)
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_candidato_tutor_docente" ON ${s}."candidato_tutor" ("docente_id")`);
    await queryRunner.query(protegerCandidatoSql(s));
    await queryRunner.query(`CREATE TRIGGER "TRG_candidato_tutor_proteger" BEFORE INSERT OR UPDATE OR DELETE ON ${s}."candidato_tutor" FOR EACH ROW EXECUTE FUNCTION ${s}."proteger_candidato_tutor"()`);

    await queryRunner.query(`ALTER TABLE ${s}."asignacion_tutor" DROP CONSTRAINT "CHK_asignacion_tutor_tipo_propuesta"`);
    await reconstruirTipoTutor(queryRunner, s, TIPOS_TUTOR);
    await queryRunner.query(`ALTER TABLE ${s}."asignacion_tutor" ADD COLUMN "candidato_tutor_id" uuid NULL`);
    await queryRunner.query(`ALTER TABLE ${s}."asignacion_tutor" ADD CONSTRAINT "FK_asignacion_tutor_candidato" FOREIGN KEY ("candidato_tutor_id","asignacion_tema_id","docente_id") REFERENCES ${s}."candidato_tutor"("id","asignacion_tema_id","docente_id") ON DELETE RESTRICT`);
    await queryRunner.query(`ALTER TABLE ${s}."asignacion_tutor" ADD CONSTRAINT "CHK_asignacion_tutor_tipo_propuesta" CHECK (${CHECK_TIPO})`);
    await queryRunner.query(protegerTutorSql(s, true));
    await queryRunner.query(composicionSql(s, true));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."asignacion_tema", ${s}."asignacion_tutor", ${s}."candidato_tutor", ${s}."grupo_integrante" IN ACCESS EXCLUSIVE MODE`);
    const [uso] = await queryRunner.query(`SELECT (SELECT count(*) FROM ${s}."asignacion_tema" WHERE "origen"='ADMIN')::int AS asignaciones, (SELECT count(*) FROM ${s}."candidato_tutor")::int AS candidatos, (SELECT count(*) FROM ${s}."asignacion_tutor" WHERE "tipo"='CANDIDATO_CONFIRMADO')::int AS tutores`) as Array<Record<string, number>>;
    if (Object.values(uso ?? {}).some(Number)) throw new Error('No se puede revertir: existen equipos administrativos, candidatos o tutores confirmados desde candidatos que conservar.');
    await queryRunner.query(composicionSql(s, false));
    await queryRunner.query(protegerTutorSql(s, false));
    await queryRunner.query(`ALTER TABLE ${s}."asignacion_tutor" DROP CONSTRAINT "CHK_asignacion_tutor_tipo_propuesta"`);
    await queryRunner.query(`ALTER TABLE ${s}."asignacion_tutor" DROP CONSTRAINT "FK_asignacion_tutor_candidato"`);
    await queryRunner.query(`ALTER TABLE ${s}."asignacion_tutor" DROP COLUMN "candidato_tutor_id"`);
    await reconstruirTipoTutor(queryRunner, s, TIPOS_TUTOR_ANTES);
    await queryRunner.query(`ALTER TABLE ${s}."asignacion_tutor" ADD CONSTRAINT "CHK_asignacion_tutor_tipo_propuesta" CHECK (${CHECK_TIPO_ANTES})`);
    await queryRunner.query(`DROP TRIGGER "TRG_candidato_tutor_proteger" ON ${s}."candidato_tutor"`);
    await queryRunner.query(`DROP FUNCTION ${s}."proteger_candidato_tutor"()`);
    await queryRunner.query(`DROP TABLE ${s}."candidato_tutor"`);
    await queryRunner.query(consistenciaAsignacionSql(s, false));
    await queryRunner.query(protegerAsignacionSql(s, false));
    await queryRunner.query(`ALTER TABLE ${s}."asignacion_tema" DROP CONSTRAINT "CHK_asignacion_tema_origen"`);
    await queryRunner.query(`ALTER TABLE ${s}."asignacion_tema" ALTER COLUMN "postulacion_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE ${s}."asignacion_tema" DROP COLUMN "origen"`);
    await queryRunner.query(`DROP TYPE ${s}."asignacion_tema_origen_enum"`);
  }
}
