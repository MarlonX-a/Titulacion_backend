import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema configurado para el banco de temas no es válido.');
  return `"${schema}"`;
}

/** `periodo`: topics belong to a period with min/max columns. `banco`: range derives from tipo + period max. */
type Modelo = 'periodo' | 'banco';

const TABLAS = ['tema', 'postulacion', 'resolucion_conflicto', 'asignacion_tema', 'lote_importacion', 'preparacion_importacion'] as const;

function validarPostulacionSql(s: string, modelo: Modelo): string {
  const banco = modelo === 'banco';
  const periodo = banco
    ? `SELECT "estado"::text,"fecha_inicio_postulacion","fecha_fin_postulacion","max_integrantes_default" INTO v_estado_periodo,v_inicio,v_fin,v_max_grupo FROM ${s}."periodo_titulacion" WHERE "id"=NEW."periodo_id" FOR UPDATE;`
    : `SELECT "estado"::text,"fecha_inicio_postulacion","fecha_fin_postulacion" INTO v_estado_periodo,v_inicio,v_fin FROM ${s}."periodo_titulacion" WHERE "id"=NEW."periodo_id" FOR UPDATE;`;
  const tema = banco
    ? `SELECT "estado"::text,CASE "tipo" WHEN 'INDIVIDUAL' THEN 1 WHEN 'PAREJA' THEN 2 ELSE 3 END,CASE "tipo" WHEN 'INDIVIDUAL' THEN 1 WHEN 'PAREJA' THEN 2 ELSE v_max_grupo END INTO v_tema_estado,v_min,v_max FROM ${s}."tema" WHERE "id"=NEW."tema_id" FOR UPDATE;`
    : `SELECT "estado"::text,"min_integrantes","max_integrantes" INTO v_tema_estado,v_min,v_max FROM ${s}."tema" WHERE "id"=NEW."tema_id" AND "periodo_id"=NEW."periodo_id" FOR UPDATE;`;
  return `
      CREATE OR REPLACE FUNCTION ${s}."validar_postulacion_y_bloquear_periodo"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_estado_periodo text; v_inicio timestamptz; v_fin timestamptz; v_tema_estado text; v_min smallint; v_max smallint; v_num integer; v_habilitados integer;${banco ? ' v_max_grupo smallint;' : ''}
      BEGIN
        IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'las postulaciones son históricas y no se eliminan físicamente' USING ERRCODE='23514'; END IF;
        IF TG_OP = 'UPDATE' THEN
          IF OLD."estado" <> 'PENDIENTE' OR NEW."estado" <> 'CANCELADA' OR NEW."id"<>OLD."id" OR NEW."tema_id"<>OLD."tema_id" OR NEW."periodo_id"<>OLD."periodo_id" OR NEW."grupo_id" IS DISTINCT FROM OLD."grupo_id" OR NEW."estudiante_id" IS DISTINCT FROM OLD."estudiante_id" OR NEW."num_integrantes"<>OLD."num_integrantes" OR NEW."registrada_por_id"<>OLD."registrada_por_id" OR NEW."fecha_postulacion"<>OLD."fecha_postulacion" OR NEW."observacion" IS NULL OR length(btrim(NEW."observacion"))=0 THEN RAISE EXCEPTION 'solo se permite cancelar postulaciones pendientes' USING ERRCODE='23514'; END IF;
          RETURN NEW;
        END IF;
        ${periodo}
        IF NOT FOUND THEN RAISE EXCEPTION 'período inexistente' USING ERRCODE='23503'; END IF;
        ${tema}
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
        IF v_min IS NULL OR v_max IS NULL OR NEW."num_integrantes" < v_min OR NEW."num_integrantes" > v_max THEN RAISE EXCEPTION 'cantidad de integrantes fuera del rango del tema' USING ERRCODE='23514'; END IF;
        RETURN NEW;
      END $$`;
}

function protegerAsignacionSql(s: string, modelo: Modelo): string {
  const tema = modelo === 'banco'
    ? `SELECT t."estado"::text AS estado,
               CASE t."tipo" WHEN 'INDIVIDUAL' THEN 1 WHEN 'PAREJA' THEN 2 ELSE 3 END AS min_integrantes,
               CASE t."tipo" WHEN 'INDIVIDUAL' THEN 1 WHEN 'PAREJA' THEN 2 ELSE p."max_integrantes_default" END AS max_integrantes
          INTO v_topic FROM ${s}."tema" t JOIN ${s}."periodo_titulacion" p ON p."id"=NEW."periodo_id"
          WHERE t."id"=NEW."tema_id" FOR UPDATE OF t;`
    : `SELECT t."estado"::text AS estado,t."min_integrantes",t."max_integrantes" INTO v_topic
          FROM ${s}."tema" t WHERE t."id"=NEW."tema_id" AND t."periodo_id"=NEW."periodo_id" FOR UPDATE;`;
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
        ${tema}
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
      END $$`;
}

/** Rebuilds lote_importacion_tipo_enum (ADD VALUE is unusable inside the migration transaction). */
async function reconstruirTipoImportacion(queryRunner: QueryRunner, s: string, valores: string[], tiposSinPeriodo: string[]): Promise<void> {
  await queryRunner.query(`ALTER TABLE ${s}."lote_importacion" DROP CONSTRAINT "CHK_lote_importacion_periodo_estudiantes"`);
  await queryRunner.query(`ALTER TABLE ${s}."preparacion_importacion" DROP CONSTRAINT "CHK_preparacion_importacion_periodo_tipo"`);
  await queryRunner.query(`ALTER TABLE ${s}."preparacion_importacion" ALTER COLUMN "tipo" DROP DEFAULT`);
  await queryRunner.query(`ALTER TYPE ${s}."lote_importacion_tipo_enum" RENAME TO "lote_importacion_tipo_enum_old"`);
  await queryRunner.query(`CREATE TYPE ${s}."lote_importacion_tipo_enum" AS ENUM (${valores.map((v) => `'${v}'`).join(', ')})`);
  for (const tabla of ['lote_importacion', 'preparacion_importacion']) {
    await queryRunner.query(`ALTER TABLE ${s}."${tabla}" ALTER COLUMN "tipo" TYPE ${s}."lote_importacion_tipo_enum" USING "tipo"::text::${s}."lote_importacion_tipo_enum"`);
  }
  await queryRunner.query(`ALTER TABLE ${s}."preparacion_importacion" ALTER COLUMN "tipo" SET DEFAULT 'ESTUDIANTES'`);
  await queryRunner.query(`DROP TYPE ${s}."lote_importacion_tipo_enum_old"`);
  await queryRunner.query(`ALTER TABLE ${s}."lote_importacion" ADD CONSTRAINT "CHK_lote_importacion_periodo_estudiantes" CHECK ("tipo" <> 'ESTUDIANTES' OR "periodo_id" IS NOT NULL)`);
  await queryRunner.query(`ALTER TABLE ${s}."preparacion_importacion" ADD CONSTRAINT "CHK_preparacion_importacion_periodo_tipo" CHECK (("tipo" = 'ESTUDIANTES' AND "periodo_id" IS NOT NULL) OR ("tipo" IN (${tiposSinPeriodo.map((v) => `'${v}'`).join(', ')}) AND "periodo_id" IS NULL))`);
}

async function contar(queryRunner: QueryRunner, sql: string): Promise<number> {
  const rows = await queryRunner.query(sql) as Array<{ total: number }>;
  return Number(rows[0]?.total ?? 0);
}

/**
 * Aborts before any change when an active application (PENDIENTE, EN_CONFLICTO, ACEPTADA) or a
 * VIGENTE assignment has a member count outside the range of the tipo derived for its topic:
 * max=1 INDIVIDUAL (1), max=2 PAREJA (2), max>=3 GRUPO (3..max_integrantes_default of its period).
 */
async function validarUsoActivo(queryRunner: QueryRunner, s: string): Promise<void> {
  const where = `FROM ${s}."postulacion" p JOIN ${s}."tema" t ON t."id" = p."tema_id" JOIN ${s}."periodo_titulacion" per ON per."id" = p."periodo_id"
    WHERE (p."estado"::text IN ('PENDIENTE', 'EN_CONFLICTO', 'ACEPTADA') OR EXISTS (SELECT 1 FROM ${s}."asignacion_tema" a WHERE a."postulacion_id" = p."id" AND a."estado"::text = 'VIGENTE'))
      AND NOT (CASE WHEN t."max_integrantes" = 1 THEN p."num_integrantes" = 1 WHEN t."max_integrantes" = 2 THEN p."num_integrantes" = 2 ELSE p."num_integrantes" BETWEEN 3 AND per."max_integrantes_default" END)`;
  const total = await contar(queryRunner, `SELECT count(DISTINCT t."id")::int AS total ${where}`);
  if (total === 0) return;
  const ejemplos = await queryRunner.query(`SELECT DISTINCT t."id"::text AS id ${where} ORDER BY 1 LIMIT 5`) as Array<{ id: string }>;
  throw new Error(`No se puede migrar al banco de temas: ${total} tema(s) tienen postulaciones activas o asignaciones vigentes cuya cantidad de integrantes no cabe en el rango de su tipo derivado (individual 1, pareja 2, grupo 3 hasta el máximo del período). Temas: ${ejemplos.map((e) => e.id).join(', ')}. Corrija o anule esas postulaciones o asignaciones antes de migrar.`);
}

/**
 * Topic bank (design 2026-11-06): topics belong to a career, not a period. The member range
 * derives from `tipo` and the period of the application/assignment; the period of use stays in
 * asignacion_tema / postulacion. Topics can be imported (lote_importacion TEMAS).
 */
export class BancoTemas20261106100000 implements MigrationInterface {
  name = 'BancoTemas20261106100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${TABLAS.map((t) => `${s}."${t}"`).join(', ')} IN ACCESS EXCLUSIVE MODE`);
    await validarUsoActivo(queryRunner, s);
    await queryRunner.query(`DROP TRIGGER "TRG_tema_bloquear_periodo_archivado" ON ${s}."tema"`);

    await queryRunner.query(`CREATE TYPE ${s}."tema_tipo_enum" AS ENUM ('INDIVIDUAL', 'PAREJA', 'GRUPO')`);
    await queryRunner.query(`ALTER TABLE ${s}."tema" ADD COLUMN "tipo" ${s}."tema_tipo_enum" NULL`);
    await queryRunner.query(`UPDATE ${s}."tema" SET "tipo" = (CASE WHEN "max_integrantes" = 1 THEN 'INDIVIDUAL' WHEN "max_integrantes" = 2 THEN 'PAREJA' ELSE 'GRUPO' END)::${s}."tema_tipo_enum"`);
    // Flushes deferred constraint-trigger events queued by the UPDATE, or the next ALTER TABLE on tema fails (55006).
    await queryRunner.query('SET CONSTRAINTS ALL IMMEDIATE');
    await queryRunner.query(`ALTER TABLE ${s}."tema" ALTER COLUMN "tipo" SET NOT NULL`);

    await queryRunner.query(`ALTER TABLE ${s}."tema" ADD COLUMN "lote_importacion_id" uuid NULL, ADD CONSTRAINT "FK_tema_lote_importacion" FOREIGN KEY ("lote_importacion_id") REFERENCES ${s}."lote_importacion"("id") ON DELETE RESTRICT`);
    await queryRunner.query(`CREATE INDEX "IDX_tema_lote_importacion" ON ${s}."tema" ("lote_importacion_id")`);

    await queryRunner.query(`ALTER TABLE ${s}."postulacion" DROP CONSTRAINT "FK_postulacion_tema_periodo", ADD CONSTRAINT "FK_postulacion_tema" FOREIGN KEY ("tema_id") REFERENCES ${s}."tema"("id") ON DELETE RESTRICT`);
    await queryRunner.query(`ALTER TABLE ${s}."resolucion_conflicto" DROP CONSTRAINT "FK_resolucion_conflicto_tema_periodo", ADD CONSTRAINT "FK_resolucion_conflicto_tema" FOREIGN KEY ("tema_id") REFERENCES ${s}."tema"("id") ON DELETE RESTRICT`);
    await queryRunner.query(`ALTER TABLE ${s}."asignacion_tema" DROP CONSTRAINT "FK_asignacion_tema_tema_periodo", ADD CONSTRAINT "FK_asignacion_tema_tema" FOREIGN KEY ("tema_id") REFERENCES ${s}."tema"("id") ON DELETE RESTRICT`);
    await queryRunner.query(`ALTER TABLE ${s}."resolucion_conflicto" DROP CONSTRAINT "UQ_resolucion_conflicto_tema", ADD CONSTRAINT "UQ_resolucion_conflicto_tema_periodo" UNIQUE ("tema_id", "periodo_id")`);

    await queryRunner.query(validarPostulacionSql(s, 'banco'));
    await queryRunner.query(protegerAsignacionSql(s, 'banco'));

    await queryRunner.query(`DROP INDEX ${s}."IDX_tema_periodo_creado"`);
    await queryRunner.query(`ALTER TABLE ${s}."tema" DROP CONSTRAINT "UQ_tema_id_periodo", DROP CONSTRAINT "FK_tema_periodo", DROP CONSTRAINT "CHK_tema_min_integrantes", DROP CONSTRAINT "CHK_tema_max_integrantes"`);
    await queryRunner.query(`ALTER TABLE ${s}."tema" DROP COLUMN "periodo_id", DROP COLUMN "min_integrantes", DROP COLUMN "max_integrantes"`);
    await queryRunner.query(`CREATE INDEX "IDX_tema_carrera_creado" ON ${s}."tema" ("carrera_id", "creado_en" DESC, "id" ASC)`);

    await reconstruirTipoImportacion(queryRunner, s, ['ESTUDIANTES', 'DOCENTES', 'TEMAS'], ['DOCENTES', 'TEMAS']);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${TABLAS.map((t) => `${s}."${t}"`).join(', ')} IN ACCESS EXCLUSIVE MODE`);
    const importaciones = await contar(queryRunner, `SELECT ((SELECT count(*) FROM ${s}."lote_importacion" WHERE "tipo" = 'TEMAS') + (SELECT count(*) FROM ${s}."preparacion_importacion" WHERE "tipo" = 'TEMAS'))::int AS total`);
    if (importaciones > 0) throw new Error('No se puede revertir el banco de temas: existen importaciones de temas.');

    await queryRunner.query(`ALTER TABLE ${s}."tema" ADD COLUMN "periodo_id" uuid NULL, ADD COLUMN "min_integrantes" smallint NULL, ADD COLUMN "max_integrantes" smallint NULL`);
    await queryRunner.query(`UPDATE ${s}."tema" t SET "periodo_id" = (SELECT a."periodo_id" FROM ${s}."asignacion_tema" a WHERE a."tema_id" = t."id" ORDER BY a."fecha_asignacion" DESC, a."id" DESC LIMIT 1)`);
    await queryRunner.query('SET CONSTRAINTS ALL IMMEDIATE');
    const sinPeriodo = await contar(queryRunner, `SELECT count(*)::int AS total FROM ${s}."tema" WHERE "periodo_id" IS NULL`);
    if (sinPeriodo > 0) throw new Error(`No se puede revertir el banco de temas: ${sinPeriodo} tema(s) no tienen una asignación de la que recuperar el período.`);
    const multiperiodo = await contar(queryRunner, `SELECT count(*)::int AS total FROM ${s}."tema" t WHERE EXISTS (SELECT 1 FROM ${s}."postulacion" p WHERE p."tema_id" = t."id" AND p."periodo_id" <> t."periodo_id") OR EXISTS (SELECT 1 FROM ${s}."resolucion_conflicto" r WHERE r."tema_id" = t."id" AND r."periodo_id" <> t."periodo_id") OR EXISTS (SELECT 1 FROM ${s}."asignacion_tema" a WHERE a."tema_id" = t."id" AND a."periodo_id" <> t."periodo_id")`);
    if (multiperiodo > 0) throw new Error(`No se puede revertir el banco de temas: ${multiperiodo} tema(s) se usaron en varios períodos.`);
    await queryRunner.query(`UPDATE ${s}."tema" t SET "min_integrantes" = CASE t."tipo" WHEN 'INDIVIDUAL' THEN 1 WHEN 'PAREJA' THEN 2 ELSE 3 END, "max_integrantes" = CASE t."tipo" WHEN 'INDIVIDUAL' THEN 1 WHEN 'PAREJA' THEN 2 ELSE GREATEST(3, p."max_integrantes_default") END FROM ${s}."periodo_titulacion" p WHERE p."id" = t."periodo_id"`);
    await queryRunner.query('SET CONSTRAINTS ALL IMMEDIATE');
    await queryRunner.query(`ALTER TABLE ${s}."tema" ALTER COLUMN "periodo_id" SET NOT NULL, ALTER COLUMN "min_integrantes" SET NOT NULL, ALTER COLUMN "max_integrantes" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE ${s}."tema" ADD CONSTRAINT "UQ_tema_id_periodo" UNIQUE ("id", "periodo_id"), ADD CONSTRAINT "FK_tema_periodo" FOREIGN KEY ("periodo_id") REFERENCES ${s}."periodo_titulacion"("id") ON DELETE RESTRICT, ADD CONSTRAINT "CHK_tema_min_integrantes" CHECK ("min_integrantes" >= 1), ADD CONSTRAINT "CHK_tema_max_integrantes" CHECK ("max_integrantes" >= "min_integrantes")`);
    await queryRunner.query(`DROP INDEX ${s}."IDX_tema_carrera_creado"`);
    await queryRunner.query(`CREATE INDEX "IDX_tema_periodo_creado" ON ${s}."tema" ("periodo_id", "creado_en" DESC, "id" ASC)`);

    await queryRunner.query(validarPostulacionSql(s, 'periodo'));
    await queryRunner.query(protegerAsignacionSql(s, 'periodo'));

    await queryRunner.query(`ALTER TABLE ${s}."resolucion_conflicto" DROP CONSTRAINT "UQ_resolucion_conflicto_tema_periodo", ADD CONSTRAINT "UQ_resolucion_conflicto_tema" UNIQUE ("tema_id")`);
    await queryRunner.query(`ALTER TABLE ${s}."asignacion_tema" DROP CONSTRAINT "FK_asignacion_tema_tema", ADD CONSTRAINT "FK_asignacion_tema_tema_periodo" FOREIGN KEY ("tema_id","periodo_id") REFERENCES ${s}."tema"("id","periodo_id") ON DELETE RESTRICT`);
    await queryRunner.query(`ALTER TABLE ${s}."resolucion_conflicto" DROP CONSTRAINT "FK_resolucion_conflicto_tema", ADD CONSTRAINT "FK_resolucion_conflicto_tema_periodo" FOREIGN KEY ("tema_id","periodo_id") REFERENCES ${s}."tema"("id","periodo_id") ON DELETE RESTRICT`);
    await queryRunner.query(`ALTER TABLE ${s}."postulacion" DROP CONSTRAINT "FK_postulacion_tema", ADD CONSTRAINT "FK_postulacion_tema_periodo" FOREIGN KEY ("tema_id","periodo_id") REFERENCES ${s}."tema"("id","periodo_id") ON DELETE RESTRICT`);

    await queryRunner.query(`ALTER TABLE ${s}."tema" DROP COLUMN "lote_importacion_id"`);
    await queryRunner.query(`ALTER TABLE ${s}."tema" DROP COLUMN "tipo"`);
    await queryRunner.query(`DROP TYPE ${s}."tema_tipo_enum"`);
    await queryRunner.query(`CREATE TRIGGER "TRG_tema_bloquear_periodo_archivado" BEFORE INSERT OR UPDATE ON ${s}."tema" FOR EACH ROW EXECUTE FUNCTION ${s}."rechazar_escritura_periodo_archivado"()`);

    await reconstruirTipoImportacion(queryRunner, s, ['ESTUDIANTES', 'DOCENTES'], ['DOCENTES']);
  }
}
