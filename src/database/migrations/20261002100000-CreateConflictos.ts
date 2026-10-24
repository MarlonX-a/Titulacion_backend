import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema configurado para conflictos no es válido.');
  return `"${schema}"`;
}

export class CreateConflictos20261002100000 implements MigrationInterface {
  name = 'CreateConflictos20261002100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`CREATE TYPE ${s}."resolucion_conflicto_criterio_enum" AS ENUM ('ORDEN_LLEGADA','PROMEDIO','SORTEO','DECISION_COMISION')`);
    await queryRunner.query(`
      CREATE TABLE ${s}."resolucion_conflicto" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(), "tema_id" uuid NOT NULL, "periodo_id" uuid NOT NULL,
        "resuelto_por_id" uuid NOT NULL, "criterio_aplicado" ${s}."resolucion_conflicto_criterio_enum" NOT NULL,
        "postulacion_ganadora_id" uuid NOT NULL, "justificacion" text NOT NULL,
        "fecha_resolucion" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_resolucion_conflicto" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_resolucion_conflicto_tema" UNIQUE ("tema_id"),
        CONSTRAINT "UQ_resolucion_conflicto_id_tema" UNIQUE ("id","tema_id"),
        CONSTRAINT "FK_resolucion_conflicto_tema_periodo" FOREIGN KEY ("tema_id","periodo_id") REFERENCES ${s}."tema"("id","periodo_id") ON DELETE RESTRICT,
        CONSTRAINT "FK_resolucion_conflicto_resuelto_por" FOREIGN KEY ("resuelto_por_id") REFERENCES ${s}."usuario"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_resolucion_conflicto_justificacion" CHECK (length(btrim("justificacion")) BETWEEN 1 AND 5000)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE ${s}."conflicto_participante" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(), "resolucion_conflicto_id" uuid NOT NULL,
        "tema_id" uuid NOT NULL, "postulacion_id" uuid NOT NULL, "puntaje_criterio" numeric(6,2) NULL,
        CONSTRAINT "PK_conflicto_participante" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_conflicto_participante_resolucion_postulacion" UNIQUE ("resolucion_conflicto_id","postulacion_id"),
        CONSTRAINT "UQ_conflicto_participante_id_postulacion" UNIQUE ("id","postulacion_id"),
        CONSTRAINT "FK_conflicto_participante_resolucion_tema" FOREIGN KEY ("resolucion_conflicto_id","tema_id") REFERENCES ${s}."resolucion_conflicto"("id","tema_id") ON DELETE RESTRICT,
        CONSTRAINT "FK_conflicto_participante_postulacion_tema" FOREIGN KEY ("postulacion_id","tema_id") REFERENCES ${s}."postulacion"("id","tema_id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`ALTER TABLE ${s}."resolucion_conflicto" ADD CONSTRAINT "FK_resolucion_conflicto_ganadora_participante" FOREIGN KEY ("id","postulacion_ganadora_id") REFERENCES ${s}."conflicto_participante"("resolucion_conflicto_id","postulacion_id") DEFERRABLE INITIALLY DEFERRED`);
    await queryRunner.query(`CREATE INDEX "IDX_resolucion_conflicto_periodo" ON ${s}."resolucion_conflicto" ("periodo_id","fecha_resolucion" DESC)`);
    await queryRunner.query(`CREATE INDEX "IDX_conflicto_participante_postulacion" ON ${s}."conflicto_participante" ("postulacion_id")`);
    await queryRunner.query(`
      CREATE FUNCTION ${s}."validar_conflicto_completo"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_resolucion uuid; v_criterio text; v_participantes integer; v_puntajes integer;
      BEGIN
        IF TG_TABLE_NAME='resolucion_conflicto' THEN
          v_resolucion := COALESCE((to_jsonb(NEW)->>'id')::uuid,(to_jsonb(OLD)->>'id')::uuid);
        ELSE
          v_resolucion := COALESCE((to_jsonb(NEW)->>'resolucion_conflicto_id')::uuid,(to_jsonb(OLD)->>'resolucion_conflicto_id')::uuid);
        END IF;
        SELECT "criterio_aplicado"::text INTO v_criterio FROM ${s}."resolucion_conflicto" WHERE "id"=v_resolucion;
        IF NOT FOUND THEN RETURN NULL; END IF;
        SELECT count(*), count("puntaje_criterio") INTO v_participantes,v_puntajes FROM ${s}."conflicto_participante" WHERE "resolucion_conflicto_id"=v_resolucion;
        IF v_participantes < 2 THEN RAISE EXCEPTION 'una resolución requiere al menos dos participantes' USING ERRCODE='23514'; END IF;
        IF v_criterio='PROMEDIO' AND v_puntajes <> v_participantes THEN RAISE EXCEPTION 'PROMEDIO requiere puntaje para todos los participantes' USING ERRCODE='23514'; END IF;
        RETURN NULL;
      END $$
    `);
    await queryRunner.query(`CREATE CONSTRAINT TRIGGER "TRG_resolucion_conflicto_completa" AFTER INSERT OR UPDATE ON ${s}."resolucion_conflicto" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${s}."validar_conflicto_completo"()`);
    await queryRunner.query(`CREATE CONSTRAINT TRIGGER "TRG_conflicto_participante_completo" AFTER INSERT OR UPDATE OR DELETE ON ${s}."conflicto_participante" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${s}."validar_conflicto_completo"()`);
    await queryRunner.query(`
      CREATE FUNCTION ${s}."proteger_historial_conflicto"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'las resoluciones y participantes de conflictos son históricos e inmutables' USING ERRCODE='23514'; END IF;
        RETURN NEW;
      END $$
    `);
    await queryRunner.query(`CREATE TRIGGER "TRG_resolucion_conflicto_inmutable" BEFORE UPDATE OR DELETE ON ${s}."resolucion_conflicto" FOR EACH ROW EXECUTE FUNCTION ${s}."proteger_historial_conflicto"()`);
    await queryRunner.query(`CREATE TRIGGER "TRG_conflicto_participante_inmutable" BEFORE UPDATE OR DELETE ON ${s}."conflicto_participante" FOR EACH ROW EXECUTE FUNCTION ${s}."proteger_historial_conflicto"()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."resolucion_conflicto", ${s}."conflicto_participante" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(`SELECT (SELECT count(*) FROM ${s}."resolucion_conflicto") + (SELECT count(*) FROM ${s}."conflicto_participante") AS total`) as Array<{ total: string }>;
    if (Number(rows[0]?.total ?? 0) > 0) throw new Error('No se puede revertir la migración: hay resoluciones o participantes de conflictos.');
    await queryRunner.query(`DROP TRIGGER "TRG_conflicto_participante_completo" ON ${s}."conflicto_participante"`);
    await queryRunner.query(`DROP TRIGGER "TRG_resolucion_conflicto_completa" ON ${s}."resolucion_conflicto"`);
    await queryRunner.query(`DROP TRIGGER "TRG_conflicto_participante_inmutable" ON ${s}."conflicto_participante"`);
    await queryRunner.query(`DROP TRIGGER "TRG_resolucion_conflicto_inmutable" ON ${s}."resolucion_conflicto"`);
    await queryRunner.query(`DROP FUNCTION ${s}."proteger_historial_conflicto"()`);
    await queryRunner.query(`DROP FUNCTION ${s}."validar_conflicto_completo"()`);
    await queryRunner.query(`ALTER TABLE ${s}."resolucion_conflicto" DROP CONSTRAINT "FK_resolucion_conflicto_ganadora_participante"`);
    await queryRunner.query(`DROP TABLE ${s}."conflicto_participante"`);
    await queryRunner.query(`DROP TABLE ${s}."resolucion_conflicto"`);
    await queryRunner.query(`DROP TYPE ${s}."resolucion_conflicto_criterio_enum"`);
  }
}
