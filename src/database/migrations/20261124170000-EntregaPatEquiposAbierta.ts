import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema configurado para la entrega PAT de equipos no es válido.');
  return `"${schema}"`;
}

/**
 * `proteger_documento_pat` as left by 20261119100000 (generated and signed deliveries), with the
 * period check parameterised. With `admisionAbierta` a team created by ADMIN (`origen = 'ADMIN'`)
 * may receive its delivery while the period is POSTULACION_ABIERTA; other origins keep the states.
 */
function protegerDocumentoSql(x: string, admisionAbierta: boolean): string {
  const estadoPeriodo = admisionAbierta
    ? `(v_periodo_estado NOT IN ('POSTULACION_CERRADA','EN_CURSO') AND NOT (v_origen='ADMIN' AND v_periodo_estado='POSTULACION_ABIERTA'))`
    : `v_periodo_estado NOT IN ('POSTULACION_CERRADA','EN_CURSO')`;
  return `CREATE OR REPLACE FUNCTION ${x}."proteger_documento_pat"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_periodo uuid; v_estado_asignacion text; v_periodo_estado text; v_origen text; v_gen_estado text; v_gen_ruta text; v_gen_hash text; v_gen_tamano bigint; v_ultima_version smallint; v_ultima_revision text; v_template_periodo uuid; v_template_activa boolean;
      BEGIN
        IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'los documentos PAT son históricos e inmutables' USING ERRCODE='23514'; END IF;
        SELECT "periodo_id" INTO v_periodo FROM ${x}."asignacion_tema" WHERE "id"=NEW."asignacion_tema_id";
        IF v_periodo IS NULL THEN RAISE EXCEPTION 'asignación inexistente' USING ERRCODE='23503'; END IF;
        SELECT "estado"::text INTO v_periodo_estado FROM ${x}."periodo_titulacion" WHERE "id"=v_periodo FOR UPDATE;
        SELECT "estado"::text,"origen"::text INTO v_estado_asignacion,v_origen FROM ${x}."asignacion_tema" WHERE "id"=NEW."asignacion_tema_id" FOR UPDATE;
        IF ${estadoPeriodo} OR v_estado_asignacion<>'VIGENTE' THEN RAISE EXCEPTION 'asignación o período no vigentes' USING ERRCODE='23514'; END IF;
        IF NEW."generacion_id" IS NOT NULL THEN
          SELECT "estado","ruta_almacenamiento","hash_sha256","tamano_bytes" INTO v_gen_estado,v_gen_ruta,v_gen_hash,v_gen_tamano FROM ${x}."generacion_pat" WHERE "id"=NEW."generacion_id" AND "asignacion_tema_id"=NEW."asignacion_tema_id" AND "estudiante_id"=NEW."estudiante_id" FOR UPDATE;
          IF NEW."estudiante_id" IS NULL OR NEW."formato"<>'PDF' OR NEW."plantilla_id" IS NOT NULL OR v_gen_estado IS DISTINCT FROM 'LISTO' OR v_gen_ruta IS NULL THEN RAISE EXCEPTION 'el documento debe corresponder a una generación PDF propia disponible' USING ERRCODE='23514'; END IF;
          IF NEW."origen"='GENERADO' AND (NEW."ruta_almacenamiento"<>v_gen_ruta OR NEW."hash_sha256"<>v_gen_hash OR NEW."tamano_bytes"<>v_gen_tamano) THEN RAISE EXCEPTION 'la entrega generada debe referenciar el archivo de su generación' USING ERRCODE='23514'; END IF;
          SELECT d."version",r."resultado"::text INTO v_ultima_version,v_ultima_revision FROM ${x}."documento_pat" d LEFT JOIN ${x}."revision_pat" r ON r."documento_pat_id"=d."id" WHERE d."asignacion_tema_id"=NEW."asignacion_tema_id" AND d."estudiante_id"=NEW."estudiante_id" ORDER BY d."version" DESC LIMIT 1;
        ELSE
          SELECT "periodo_id","activa" INTO v_template_periodo,v_template_activa FROM ${x}."plantilla_pat" WHERE "id"=NEW."plantilla_id" FOR UPDATE;
          IF NEW."estudiante_id" IS NOT NULL OR v_template_periodo IS DISTINCT FROM v_periodo OR v_template_activa IS NOT TRUE THEN RAISE EXCEPTION 'plantilla histórica inválida' USING ERRCODE='23514'; END IF;
          SELECT d."version",r."resultado"::text INTO v_ultima_version,v_ultima_revision FROM ${x}."documento_pat" d LEFT JOIN ${x}."revision_pat" r ON r."documento_pat_id"=d."id" WHERE d."asignacion_tema_id"=NEW."asignacion_tema_id" AND d."estudiante_id" IS NULL ORDER BY d."version" DESC LIMIT 1;
        END IF;
        IF v_ultima_version IS NOT NULL AND (v_ultima_revision IS NULL OR v_ultima_revision NOT IN ('OBSERVADO','RECHAZADO')) THEN RAISE EXCEPTION 'la última versión personal debe estar observada o rechazada' USING ERRCODE='23514'; END IF;
        IF NEW."origen"<>'GENERADO' AND NOT EXISTS(SELECT 1 FROM ${x}."archivo_limpieza_pendiente" WHERE "ruta_almacenamiento"=NEW."ruta_almacenamiento") THEN RAISE EXCEPTION 'el archivo debe tener intención registrada' USING ERRCODE='23514'; END IF;
        RETURN NEW;
      END $$`;
}

/**
 * Los equipos administrativos pueden entregar su PAT (firmado o generado) con la postulación abierta.
 * El resto de asignaciones mantiene CERRADA o EN_CURSO.
 */
export class EntregaPatEquiposAbierta20261124170000 implements MigrationInterface {
  name = 'EntregaPatEquiposAbierta20261124170000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const x = schemaName(queryRunner);
    await queryRunner.query(protegerDocumentoSql(x, true));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const x = schemaName(queryRunner);
    const abiertos = await queryRunner.query(`SELECT count(*)::int AS total FROM ${x}."documento_pat" d JOIN ${x}."asignacion_tema" a ON a."id"=d."asignacion_tema_id" JOIN ${x}."periodo_titulacion" p ON p."id"=a."periodo_id" WHERE a."origen"='ADMIN' AND p."estado"='POSTULACION_ABIERTA'`) as Array<{ total: number }>;
    if (Number(abiertos[0]?.total ?? 0) > 0) {
      throw new Error('No se puede revertir la migración: existen entregas PAT de equipos administrativos en un período en POSTULACION_ABIERTA.');
    }
    await queryRunner.query(protegerDocumentoSql(x, false));
  }
}
