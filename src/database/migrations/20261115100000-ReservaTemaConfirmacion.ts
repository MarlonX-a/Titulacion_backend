import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema configurado para la reserva de temas no es válido.');
  return `"${schema}"`;
}

/** Marca de las filas de historial que inserta esta migración (para poder revertirlas). */
const MARCA_MIGRACION = 'ReservaTemaConfirmacion20261115100000';

const TEMA_ESTADOS_ANTES = ['BORRADOR', 'PUBLICADO', 'CERRADO', 'ASIGNADO', 'RETIRADO'];
const TEMA_ESTADOS = [...TEMA_ESTADOS_ANTES, 'RESERVADO'];
const POSTULACION_ESTADOS_ANTES = ['PENDIENTE', 'EN_CONFLICTO', 'ACEPTADA', 'RECHAZADA', 'CANCELADA', 'ANULADA'];
const POSTULACION_ESTADOS = [...POSTULACION_ESTADOS_ANTES, 'PENDIENTE_CONFIRMACION'];

interface ColumnaEnum { tabla: string; columna: string; defecto?: string }

/**
 * Rebuilds an enum type with a new value list. `ALTER TYPE ... ADD VALUE` cannot be used here:
 * TypeORM runs every pending migration in one transaction and the new value could not be used
 * by the indexes and updates of this same migration.
 */
async function reconstruirEnum(queryRunner: QueryRunner, s: string, tipo: string, valores: string[], columnas: ColumnaEnum[]): Promise<void> {
  for (const c of columnas) if (c.defecto) await queryRunner.query(`ALTER TABLE ${s}."${c.tabla}" ALTER COLUMN "${c.columna}" DROP DEFAULT`);
  await queryRunner.query(`ALTER TYPE ${s}."${tipo}" RENAME TO "${tipo}_old"`);
  await queryRunner.query(`CREATE TYPE ${s}."${tipo}" AS ENUM (${valores.map((v) => `'${v}'`).join(', ')})`);
  for (const c of columnas) {
    await queryRunner.query(`ALTER TABLE ${s}."${c.tabla}" ALTER COLUMN "${c.columna}" TYPE ${s}."${tipo}" USING "${c.columna}"::text::${s}."${tipo}"`);
  }
  for (const c of columnas) if (c.defecto) await queryRunner.query(`ALTER TABLE ${s}."${c.tabla}" ALTER COLUMN "${c.columna}" SET DEFAULT '${c.defecto}'`);
  await queryRunner.query(`DROP TYPE ${s}."${tipo}_old"`);
}

const INDICES_POSTULACION = ['UQ_postulacion_activa_grupo', 'UQ_postulacion_activa_estudiante', 'UQ_postulacion_tema_grupo_no_cancelada', 'UQ_postulacion_tema_estudiante_no_cancelada', 'UQ_postulacion_tema_aceptada'];

async function crearIndicesPostulacion(queryRunner: QueryRunner, s: string, activos: string): Promise<void> {
  await queryRunner.query(`CREATE UNIQUE INDEX "UQ_postulacion_activa_grupo" ON ${s}."postulacion" ("periodo_id","grupo_id") WHERE "grupo_id" IS NOT NULL AND "estado" IN (${activos})`);
  await queryRunner.query(`CREATE UNIQUE INDEX "UQ_postulacion_activa_estudiante" ON ${s}."postulacion" ("periodo_id","estudiante_id") WHERE "estudiante_id" IS NOT NULL AND "estado" IN (${activos})`);
  await queryRunner.query(`CREATE UNIQUE INDEX "UQ_postulacion_tema_grupo_no_cancelada" ON ${s}."postulacion" ("tema_id","grupo_id") WHERE "grupo_id" IS NOT NULL AND "estado" <> 'CANCELADA'`);
  await queryRunner.query(`CREATE UNIQUE INDEX "UQ_postulacion_tema_estudiante_no_cancelada" ON ${s}."postulacion" ("tema_id","estudiante_id") WHERE "estudiante_id" IS NOT NULL AND "estado" <> 'CANCELADA'`);
  await queryRunner.query(`CREATE UNIQUE INDEX "UQ_postulacion_tema_aceptada" ON ${s}."postulacion" ("tema_id") WHERE "estado" = 'ACEPTADA'`);
}

/** `validar_postulacion_y_bloquear_periodo` (topic-bank model of 20261106100000) with or without reservations. */
function validarPostulacionSql(s: string, reserva: boolean): string {
  const activos = reserva ? `'PENDIENTE_CONFIRMACION','PENDIENTE','EN_CONFLICTO','ACEPTADA'` : `'PENDIENTE','EN_CONFLICTO','ACEPTADA'`;
  const estadoInicial = reserva
    ? `\n        IF TG_OP = 'INSERT' AND NEW."estado" NOT IN ('PENDIENTE_CONFIRMACION','PENDIENTE') THEN RAISE EXCEPTION 'una postulación nueva debe quedar PENDIENTE_CONFIRMACION o PENDIENTE' USING ERRCODE='23514'; END IF;`
    : '';
  return `
      CREATE OR REPLACE FUNCTION ${s}."validar_postulacion_y_bloquear_periodo"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_estado_periodo text; v_inicio timestamptz; v_fin timestamptz; v_tema_estado text; v_min smallint; v_max smallint; v_num integer; v_habilitados integer; v_max_grupo smallint;
      BEGIN
        IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'las postulaciones son históricas y no se eliminan físicamente' USING ERRCODE='23514'; END IF;${estadoInicial}
        IF TG_OP = 'UPDATE' THEN
          IF OLD."estado" <> 'PENDIENTE' OR NEW."estado" <> 'CANCELADA' OR NEW."id"<>OLD."id" OR NEW."tema_id"<>OLD."tema_id" OR NEW."periodo_id"<>OLD."periodo_id" OR NEW."grupo_id" IS DISTINCT FROM OLD."grupo_id" OR NEW."estudiante_id" IS DISTINCT FROM OLD."estudiante_id" OR NEW."num_integrantes"<>OLD."num_integrantes" OR NEW."registrada_por_id"<>OLD."registrada_por_id" OR NEW."fecha_postulacion"<>OLD."fecha_postulacion" OR NEW."observacion" IS NULL OR length(btrim(NEW."observacion"))=0 THEN RAISE EXCEPTION 'solo se permite cancelar postulaciones pendientes' USING ERRCODE='23514'; END IF;
          RETURN NEW;
        END IF;
        SELECT "estado"::text,"fecha_inicio_postulacion","fecha_fin_postulacion","max_integrantes_default" INTO v_estado_periodo,v_inicio,v_fin,v_max_grupo FROM ${s}."periodo_titulacion" WHERE "id"=NEW."periodo_id" FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'período inexistente' USING ERRCODE='23503'; END IF;
        SELECT "estado"::text,CASE "tipo" WHEN 'INDIVIDUAL' THEN 1 WHEN 'PAREJA' THEN 2 ELSE 3 END,CASE "tipo" WHEN 'INDIVIDUAL' THEN 1 WHEN 'PAREJA' THEN 2 ELSE v_max_grupo END INTO v_tema_estado,v_min,v_max FROM ${s}."tema" WHERE "id"=NEW."tema_id" FOR UPDATE;
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
          IF EXISTS (SELECT 1 FROM ${s}."grupo_integrante" m JOIN ${s}."postulacion" p ON p."periodo_id"=m."periodo_id" AND p."estudiante_id"=m."estudiante_id" WHERE m."grupo_id"=NEW."grupo_id" AND m."estado"='ACTIVO' AND p."estado" IN (${activos})) THEN RAISE EXCEPTION 'participante con postulación individual activa' USING ERRCODE='23514'; END IF;
        END IF;
        IF v_min IS NULL OR v_max IS NULL OR NEW."num_integrantes" < v_min OR NEW."num_integrantes" > v_max THEN RAISE EXCEPTION 'cantidad de integrantes fuera del rango del tema' USING ERRCODE='23514'; END IF;
        RETURN NEW;
      END $$`;
}

/** `proteger_composicion_postulacion` (version of 20261019100000) with or without PENDIENTE_CONFIRMACION as active. */
function protegerComposicionSql(s: string, reserva: boolean): string {
  const activos = reserva ? `'PENDIENTE_CONFIRMACION','PENDIENTE','EN_CONFLICTO','ACEPTADA'` : `'PENDIENTE','EN_CONFLICTO','ACEPTADA'`;
  return `
      CREATE OR REPLACE FUNCTION ${s}."proteger_composicion_postulacion"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_periodo uuid; v_grupo uuid; v_individual boolean;
      BEGIN
        v_periodo := CASE WHEN TG_OP='DELETE' THEN OLD."periodo_id" ELSE NEW."periodo_id" END;
        v_grupo := CASE WHEN TG_OP='DELETE' THEN OLD."grupo_id" ELSE NEW."grupo_id" END;
        PERFORM 1 FROM ${s}."periodo_titulacion" WHERE "id"=v_periodo FOR UPDATE;
        IF TG_OP='INSERT' THEN
          IF EXISTS (SELECT 1 FROM ${s}."postulacion" WHERE "grupo_id"=NEW."grupo_id") THEN RAISE EXCEPTION 'la composición del grupo está cerrada por una postulación' USING ERRCODE='23514'; END IF;
          SELECT EXISTS(SELECT 1 FROM ${s}."postulacion" WHERE "periodo_id"=NEW."periodo_id" AND "estudiante_id"=NEW."estudiante_id" AND "estado" IN (${activos})) INTO v_individual;
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
        IF EXISTS (SELECT 1 FROM ${s}."postulacion" WHERE "grupo_id"=v_grupo) THEN RAISE EXCEPTION 'la composición del grupo está cerrada por una postulación' USING ERRCODE='23514'; END IF;
        RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
      END $$`;
}

/** `validar_transicion_postulacion_asignacion` (version of 20261002110000) with or without the confirmation transitions. */
function transicionPostulacionSql(s: string, reserva: boolean): string {
  const confirmacion = reserva
    ? `
        IF OLD."estado"='PENDIENTE_CONFIRMACION' AND NEW."estado"='PENDIENTE' THEN RETURN NEW; END IF;`
    : '';
  const origenesConObservacion = reserva
    ? `(OLD."estado"='PENDIENTE' AND NEW."estado" IN ('CANCELADA','ACEPTADA','RECHAZADA')) OR
           (OLD."estado"='PENDIENTE_CONFIRMACION' AND NEW."estado" IN ('CANCELADA','RECHAZADA')) OR`
    : `(OLD."estado"='PENDIENTE' AND NEW."estado" IN ('CANCELADA','ACEPTADA','RECHAZADA')) OR`;
  return `
      CREATE OR REPLACE FUNCTION ${s}."validar_transicion_postulacion_asignacion"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP<>'UPDATE' OR NEW."id"<>OLD."id" OR NEW."tema_id"<>OLD."tema_id" OR NEW."periodo_id"<>OLD."periodo_id" OR
          NEW."grupo_id" IS DISTINCT FROM OLD."grupo_id" OR NEW."estudiante_id" IS DISTINCT FROM OLD."estudiante_id" OR
          NEW."num_integrantes"<>OLD."num_integrantes" OR NEW."registrada_por_id"<>OLD."registrada_por_id" OR NEW."fecha_postulacion"<>OLD."fecha_postulacion" THEN
          RAISE EXCEPTION 'no se pueden cambiar las referencias históricas de una postulación' USING ERRCODE='23514';
        END IF;${confirmacion}
        IF ${origenesConObservacion}
           (OLD."estado"='EN_CONFLICTO' AND NEW."estado"='RECHAZADA') OR
           (OLD."estado"='ACEPTADA' AND NEW."estado"='ANULADA') THEN
          IF NEW."observacion" IS NULL OR length(btrim(NEW."observacion"))=0 THEN RAISE EXCEPTION 'la transición requiere observación' USING ERRCODE='23514'; END IF;
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'transición de postulación no permitida' USING ERRCODE='23514';
      END $$`;
}

/** `proteger_asignacion_tema` (topic-bank version of 20261106100000); with reservations the topic may be RESERVADO. */
function protegerAsignacionSql(s: string, reserva: boolean): string {
  const temaValido = reserva ? `v_topic.estado NOT IN ('PUBLICADO','RESERVADO')` : `v_topic.estado<>'PUBLICADO'`;
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
        IF NOT FOUND OR ${temaValido} THEN
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
      END $$`;
}

/** Confirmation rows are history: only PENDIENTE → CONFIRMADA | RECHAZADA, never deleted. */
function protegerConfirmacionSql(s: string): string {
  return `
      CREATE FUNCTION ${s}."proteger_postulacion_confirmacion"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'las confirmaciones de postulación son históricas y no se eliminan' USING ERRCODE='23514'; END IF;
        IF OLD."estado" <> 'PENDIENTE' OR NEW."estado" NOT IN ('CONFIRMADA','RECHAZADA') OR NEW."respondida_en" IS NULL
           OR NEW."id" <> OLD."id" OR NEW."postulacion_id" <> OLD."postulacion_id" OR NEW."estudiante_id" <> OLD."estudiante_id" OR NEW."creado_en" <> OLD."creado_en" THEN
          RAISE EXCEPTION 'solo se puede responder una confirmación pendiente' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$`;
}

/**
 * Block 3 (design 2026-11-15): reservation of a topic by one postulación and mandatory
 * confirmation by every group member.
 *
 * - tema_estado_enum += RESERVADO; postulacion_estado_enum += PENDIENTE_CONFIRMACION.
 * - postulacion_confirmacion: one row per participant (PENDIENTE | CONFIRMADA | RECHAZADA).
 * - PENDIENTE_CONFIRMACION counts as an active postulación in the unique indexes and triggers.
 * - Exclusivity: `UQ_postulacion_reserva_tema` (one PENDIENTE_CONFIRMACION / PENDIENTE per topic) for
 *   postulaciones created from this migration on. Legacy rows are not covered because rows of
 *   ARCHIVADO periods are immutable and the old model allowed several PENDIENTE per topic; their
 *   PUBLICADO topics become RESERVADO here so the insert trigger rejects new postulaciones until
 *   they are resolved.
 * - tema_historial.usuario_id admits NULL only for automatic changes (`cambios.automatico = true`).
 */
export class ReservaTemaConfirmacion20261115100000 implements MigrationInterface {
  name = 'ReservaTemaConfirmacion20261115100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."periodo_titulacion", ${s}."tema", ${s}."tema_historial", ${s}."postulacion" IN ACCESS EXCLUSIVE MODE`);

    for (const indice of INDICES_POSTULACION) await queryRunner.query(`DROP INDEX ${s}."${indice}"`);
    await reconstruirEnum(queryRunner, s, 'tema_estado_enum', TEMA_ESTADOS, [
      { tabla: 'tema', columna: 'estado', defecto: 'BORRADOR' },
      { tabla: 'tema_historial', columna: 'estado_anterior' },
      { tabla: 'tema_historial', columna: 'estado_nuevo' },
    ]);
    await reconstruirEnum(queryRunner, s, 'postulacion_estado_enum', POSTULACION_ESTADOS, [{ tabla: 'postulacion', columna: 'estado', defecto: 'PENDIENTE' }]);
    await crearIndicesPostulacion(queryRunner, s, `'PENDIENTE_CONFIRMACION','PENDIENTE','EN_CONFLICTO','ACEPTADA'`);
    const corte = (await queryRunner.query('SELECT clock_timestamp() AS ahora') as Array<{ ahora: Date }>)[0]!.ahora;
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_postulacion_reserva_tema" ON ${s}."postulacion" ("tema_id") WHERE "estado" IN ('PENDIENTE_CONFIRMACION','PENDIENTE') AND "fecha_postulacion" >= '${new Date(corte).toISOString()}'::timestamptz`);

    await queryRunner.query(`CREATE TYPE ${s}."postulacion_confirmacion_estado_enum" AS ENUM ('PENDIENTE', 'CONFIRMADA', 'RECHAZADA')`);
    await queryRunner.query(`
      CREATE TABLE ${s}."postulacion_confirmacion" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "postulacion_id" uuid NOT NULL,
        "estudiante_id" uuid NOT NULL,
        "estado" ${s}."postulacion_confirmacion_estado_enum" NOT NULL DEFAULT 'PENDIENTE',
        "motivo" text NULL,
        "respondida_en" TIMESTAMP WITH TIME ZONE NULL,
        "creado_en" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_postulacion_confirmacion" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_postulacion_confirmacion_estudiante" UNIQUE ("postulacion_id", "estudiante_id"),
        CONSTRAINT "FK_postulacion_confirmacion_postulacion" FOREIGN KEY ("postulacion_id") REFERENCES ${s}."postulacion"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_postulacion_confirmacion_estudiante" FOREIGN KEY ("estudiante_id") REFERENCES ${s}."estudiante"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_postulacion_confirmacion_respuesta" CHECK (("estado" = 'PENDIENTE') = ("respondida_en" IS NULL)),
        CONSTRAINT "CHK_postulacion_confirmacion_motivo" CHECK ("motivo" IS NULL OR ("estado" = 'RECHAZADA' AND length(btrim("motivo")) BETWEEN 1 AND 500))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_postulacion_confirmacion_estudiante" ON ${s}."postulacion_confirmacion" ("estudiante_id", "estado")`);
    await queryRunner.query(protegerConfirmacionSql(s));
    await queryRunner.query(`CREATE TRIGGER "TRG_postulacion_confirmacion_proteger" BEFORE UPDATE OR DELETE ON ${s}."postulacion_confirmacion" FOR EACH ROW EXECUTE FUNCTION ${s}."proteger_postulacion_confirmacion"()`);

    await queryRunner.query(`ALTER TABLE ${s}."tema_historial" ALTER COLUMN "usuario_id" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE ${s}."tema_historial" ADD CONSTRAINT "CHK_tema_historial_usuario_o_automatico" CHECK ("usuario_id" IS NOT NULL OR coalesce("cambios"->>'automatico', '') = 'true')`);

    await queryRunner.query(validarPostulacionSql(s, true));
    await queryRunner.query(protegerComposicionSql(s, true));
    await queryRunner.query(transicionPostulacionSql(s, true));
    await queryRunner.query(protegerAsignacionSql(s, true));

    // Legacy: a PUBLICADO topic with a PENDIENTE postulación of a non-archived period is already taken.
    await queryRunner.query(`
      WITH reservados AS (
        UPDATE ${s}."tema" t SET "estado" = 'RESERVADO'
        WHERE t."estado" = 'PUBLICADO' AND EXISTS (
          SELECT 1 FROM ${s}."postulacion" p JOIN ${s}."periodo_titulacion" pe ON pe."id" = p."periodo_id"
          WHERE p."tema_id" = t."id" AND p."estado" = 'PENDIENTE' AND pe."estado" <> 'ARCHIVADO'
        )
        RETURNING t."id"
      )
      INSERT INTO ${s}."tema_historial" ("tema_id", "usuario_id", "estado_anterior", "estado_nuevo", "cambios")
      SELECT r."id", NULL, 'PUBLICADO', 'RESERVADO', jsonb_build_object('automatico', true, 'migracion', '${MARCA_MIGRACION}', 'motivo', 'Tema con postulación PENDIENTE existente al introducir la reserva.')
      FROM reservados r
    `);
    await queryRunner.query('SET CONSTRAINTS ALL IMMEDIATE');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."periodo_titulacion", ${s}."tema", ${s}."tema_historial", ${s}."postulacion", ${s}."postulacion_confirmacion" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(`
      SELECT (SELECT count(*) FROM ${s}."postulacion_confirmacion")::int AS confirmaciones,
             (SELECT count(*) FROM ${s}."postulacion" WHERE "estado" = 'PENDIENTE_CONFIRMACION')::int AS pendientes,
             (SELECT count(*) FROM ${s}."tema_historial" WHERE "usuario_id" IS NULL AND ("cambios"->>'migracion') IS DISTINCT FROM '${MARCA_MIGRACION}')::int AS automaticos
    `) as Array<{ confirmaciones: number; pendientes: number; automaticos: number }>;
    const datos = rows[0]!;
    if (Number(datos.confirmaciones) > 0 || Number(datos.pendientes) > 0 || Number(datos.automaticos) > 0) {
      throw new Error('No se puede revertir la reserva de temas: existen confirmaciones, postulaciones PENDIENTE_CONFIRMACION o historial automático de reservas.');
    }
    await queryRunner.query(`DELETE FROM ${s}."tema_historial" WHERE "usuario_id" IS NULL AND ("cambios"->>'migracion') = '${MARCA_MIGRACION}'`);
    await queryRunner.query(`UPDATE ${s}."tema" SET "estado" = 'PUBLICADO' WHERE "estado" = 'RESERVADO'`);
    await queryRunner.query('SET CONSTRAINTS ALL IMMEDIATE');

    await queryRunner.query(validarPostulacionSql(s, false));
    await queryRunner.query(protegerComposicionSql(s, false));
    await queryRunner.query(transicionPostulacionSql(s, false));
    await queryRunner.query(protegerAsignacionSql(s, false));

    await queryRunner.query(`ALTER TABLE ${s}."tema_historial" DROP CONSTRAINT "CHK_tema_historial_usuario_o_automatico"`);
    await queryRunner.query(`ALTER TABLE ${s}."tema_historial" ALTER COLUMN "usuario_id" SET NOT NULL`);
    await queryRunner.query(`DROP TABLE ${s}."postulacion_confirmacion"`);
    await queryRunner.query(`DROP FUNCTION ${s}."proteger_postulacion_confirmacion"()`);
    await queryRunner.query(`DROP TYPE ${s}."postulacion_confirmacion_estado_enum"`);

    await queryRunner.query(`DROP INDEX ${s}."UQ_postulacion_reserva_tema"`);
    for (const indice of INDICES_POSTULACION) await queryRunner.query(`DROP INDEX ${s}."${indice}"`);
    await reconstruirEnum(queryRunner, s, 'postulacion_estado_enum', POSTULACION_ESTADOS_ANTES, [{ tabla: 'postulacion', columna: 'estado', defecto: 'PENDIENTE' }]);
    await reconstruirEnum(queryRunner, s, 'tema_estado_enum', TEMA_ESTADOS_ANTES, [
      { tabla: 'tema', columna: 'estado', defecto: 'BORRADOR' },
      { tabla: 'tema_historial', columna: 'estado_anterior' },
      { tabla: 'tema_historial', columna: 'estado_nuevo' },
    ]);
    await crearIndicesPostulacion(queryRunner, s, `'PENDIENTE','EN_CONFLICTO','ACEPTADA'`);
  }
}
