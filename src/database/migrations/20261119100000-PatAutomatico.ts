import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function s(q: QueryRunner): string {
  const n = (q.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(n)) throw new Error('Esquema inválido para PAT automático.');
  return `"${n}"`;
}

/**
 * Transiciones de generación. `recuperacion` añade PROCESANDO -> EN_COLA con ciclo+1 (generaciones
 * atascadas); sin ella se restaura la función de 20261107100000-GeneracionPatIndividual.
 */
function protegerGeneracion(x: string, recuperacion: boolean): string {
  const retry = recuperacion
    ? `(OLD."estado" IN ('FALLIDO','PROCESANDO') AND NEW."estado"='EN_COLA' AND NEW."ciclo"=OLD."ciclo"+1)`
    : `(OLD."estado"='FALLIDO' AND NEW."estado"='EN_COLA' AND NEW."ciclo"=OLD."ciclo"+1)`;
  return `CREATE OR REPLACE FUNCTION ${x}."proteger_generacion_pat"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP='DELETE' THEN RAISE EXCEPTION 'las generaciones PAT son históricas' USING ERRCODE='23514'; END IF; IF NEW."id"<>OLD."id" OR NEW."asignacion_tema_id"<>OLD."asignacion_tema_id" OR NEW."estudiante_id"<>OLD."estudiante_id" OR NEW."solicitada_por_id"<>OLD."solicitada_por_id" OR NEW."version_diseno"<>OLD."version_diseno" OR NEW."instantanea"<>OLD."instantanea" OR NEW."solicitada_en"<>OLD."solicitada_en" OR NOT ((OLD."ciclo"=NEW."ciclo" AND ((OLD."estado"='EN_COLA' AND NEW."estado" IN ('PROCESANDO','LISTO','FALLIDO')) OR (OLD."estado"='PROCESANDO' AND NEW."estado" IN ('LISTO','FALLIDO')))) OR ${retry}) THEN RAISE EXCEPTION 'generación PAT inmutable o transición no permitida' USING ERRCODE='23514'; END IF; IF OLD."estado"='LISTO' THEN RAISE EXCEPTION 'archivo generado inmutable' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`;
}

/**
 * Inserción de documentos PAT. `origen` distingue la entrega directa de la generación (GENERADO:
 * misma ruta, hash y tamaño que la generación, sin intención de carga) de la carga firmada (FIRMADO).
 */
function protegerDocumento(x: string, origen: boolean): string {
  const generationCheck = origen
    ? `SELECT "estado","ruta_almacenamiento","hash_sha256","tamano_bytes" INTO v_gen_estado,v_gen_ruta,v_gen_hash,v_gen_tamano FROM ${x}."generacion_pat" WHERE "id"=NEW."generacion_id" AND "asignacion_tema_id"=NEW."asignacion_tema_id" AND "estudiante_id"=NEW."estudiante_id" FOR UPDATE;
          IF NEW."estudiante_id" IS NULL OR NEW."formato"<>'PDF' OR NEW."plantilla_id" IS NOT NULL OR v_gen_estado IS DISTINCT FROM 'LISTO' OR v_gen_ruta IS NULL THEN RAISE EXCEPTION 'el documento debe corresponder a una generación PDF propia disponible' USING ERRCODE='23514'; END IF;
          IF NEW."origen"='GENERADO' AND (NEW."ruta_almacenamiento"<>v_gen_ruta OR NEW."hash_sha256"<>v_gen_hash OR NEW."tamano_bytes"<>v_gen_tamano) THEN RAISE EXCEPTION 'la entrega generada debe referenciar el archivo de su generación' USING ERRCODE='23514'; END IF;`
    : `SELECT "estado","ruta_almacenamiento" INTO v_gen_estado,v_gen_ruta FROM ${x}."generacion_pat" WHERE "id"=NEW."generacion_id" AND "asignacion_tema_id"=NEW."asignacion_tema_id" AND "estudiante_id"=NEW."estudiante_id" FOR UPDATE;
          IF NEW."estudiante_id" IS NULL OR NEW."formato"<>'PDF' OR NEW."plantilla_id" IS NOT NULL OR v_gen_estado<>'LISTO' OR v_gen_ruta IS NULL THEN RAISE EXCEPTION 'el documento debe corresponder a una generación PDF propia disponible' USING ERRCODE='23514'; END IF;`;
  const intention = origen
    ? `IF NEW."origen"<>'GENERADO' AND NOT EXISTS(SELECT 1 FROM ${x}."archivo_limpieza_pendiente" WHERE "ruta_almacenamiento"=NEW."ruta_almacenamiento") THEN RAISE EXCEPTION 'el archivo debe tener intención registrada' USING ERRCODE='23514'; END IF;`
    : `IF NOT EXISTS(SELECT 1 FROM ${x}."archivo_limpieza_pendiente" WHERE "ruta_almacenamiento"=NEW."ruta_almacenamiento") THEN RAISE EXCEPTION 'el archivo debe tener intención registrada' USING ERRCODE='23514'; END IF;`;
  const extraVars = origen ? ' v_gen_hash text; v_gen_tamano bigint;' : '';
  return `CREATE OR REPLACE FUNCTION ${x}."proteger_documento_pat"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_periodo uuid; v_estado_asignacion text; v_periodo_estado text; v_gen_estado text; v_gen_ruta text; v_ultima_version smallint; v_ultima_revision text; v_template_periodo uuid; v_template_activa boolean;${extraVars}
      BEGIN
        IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'los documentos PAT son históricos e inmutables' USING ERRCODE='23514'; END IF;
        SELECT "periodo_id" INTO v_periodo FROM ${x}."asignacion_tema" WHERE "id"=NEW."asignacion_tema_id";
        IF v_periodo IS NULL THEN RAISE EXCEPTION 'asignación inexistente' USING ERRCODE='23503'; END IF;
        SELECT "estado"::text INTO v_periodo_estado FROM ${x}."periodo_titulacion" WHERE "id"=v_periodo FOR UPDATE;
        SELECT "estado"::text INTO v_estado_asignacion FROM ${x}."asignacion_tema" WHERE "id"=NEW."asignacion_tema_id" FOR UPDATE;
        IF v_periodo_estado NOT IN ('POSTULACION_CERRADA','EN_CURSO') OR v_estado_asignacion<>'VIGENTE' THEN RAISE EXCEPTION 'asignación o período no vigentes' USING ERRCODE='23514'; END IF;
        IF NEW."generacion_id" IS NOT NULL THEN
          ${generationCheck}
          SELECT d."version",r."resultado"::text INTO v_ultima_version,v_ultima_revision FROM ${x}."documento_pat" d LEFT JOIN ${x}."revision_pat" r ON r."documento_pat_id"=d."id" WHERE d."asignacion_tema_id"=NEW."asignacion_tema_id" AND d."estudiante_id"=NEW."estudiante_id" ORDER BY d."version" DESC LIMIT 1;
        ELSE
          SELECT "periodo_id","activa" INTO v_template_periodo,v_template_activa FROM ${x}."plantilla_pat" WHERE "id"=NEW."plantilla_id" FOR UPDATE;
          IF NEW."estudiante_id" IS NOT NULL OR v_template_periodo IS DISTINCT FROM v_periodo OR v_template_activa IS NOT TRUE THEN RAISE EXCEPTION 'plantilla histórica inválida' USING ERRCODE='23514'; END IF;
          SELECT d."version",r."resultado"::text INTO v_ultima_version,v_ultima_revision FROM ${x}."documento_pat" d LEFT JOIN ${x}."revision_pat" r ON r."documento_pat_id"=d."id" WHERE d."asignacion_tema_id"=NEW."asignacion_tema_id" AND d."estudiante_id" IS NULL ORDER BY d."version" DESC LIMIT 1;
        END IF;
        IF v_ultima_version IS NOT NULL AND (v_ultima_revision IS NULL OR v_ultima_revision NOT IN ('OBSERVADO','RECHAZADO')) THEN RAISE EXCEPTION 'la última versión personal debe estar observada o rechazada' USING ERRCODE='23514'; END IF;
        ${intention}
        RETURN NEW;
      END $$`;
}

/**
 * PAT automático: entrega directa de la generación sin firma (`documento_pat.origen`) y recuperación
 * de generaciones atascadas en PROCESANDO (`generacion_pat.procesando_desde`).
 */
export class PatAutomatico20261119100000 implements MigrationInterface {
  name = 'PatAutomatico20261119100000';

  async up(q: QueryRunner): Promise<void> {
    const x = s(q);
    await q.query(`ALTER TABLE ${x}."documento_pat" ADD COLUMN "origen" varchar(20) NOT NULL DEFAULT 'FIRMADO', ADD CONSTRAINT "CHK_documento_pat_origen" CHECK ("origen" IN ('GENERADO','FIRMADO')), ADD CONSTRAINT "CHK_documento_pat_origen_generacion" CHECK ("origen"<>'GENERADO' OR "generacion_id" IS NOT NULL)`);
    await q.query(`CREATE UNIQUE INDEX "UQ_documento_pat_generacion_entregada" ON ${x}."documento_pat"("generacion_id") WHERE "origen"='GENERADO'`);
    await q.query(`ALTER TABLE ${x}."generacion_pat" ADD COLUMN "procesando_desde" timestamptz`);
    await q.query(protegerGeneracion(x, true));
    await q.query(protegerDocumento(x, true));
  }

  async down(q: QueryRunner): Promise<void> {
    const x = s(q);
    await q.query(`LOCK TABLE ${x}."documento_pat",${x}."generacion_pat" IN ACCESS EXCLUSIVE MODE`);
    const rows = await q.query(`SELECT count(*)::int AS total FROM ${x}."documento_pat" WHERE "origen"='GENERADO'`) as Array<{ total: number }>;
    if (Number(rows[0]?.total ?? 0) > 0) throw new Error('No se puede revertir: hay entregas PAT generadas sin firma que conservar.');
    await q.query(protegerDocumento(x, false));
    await q.query(protegerGeneracion(x, false));
    await q.query(`ALTER TABLE ${x}."generacion_pat" DROP COLUMN "procesando_desde"`);
    await q.query(`DROP INDEX ${x}."UQ_documento_pat_generacion_entregada"`);
    await q.query(`ALTER TABLE ${x}."documento_pat" DROP CONSTRAINT "CHK_documento_pat_origen_generacion", DROP CONSTRAINT "CHK_documento_pat_origen", DROP COLUMN "origen"`);
  }
}
