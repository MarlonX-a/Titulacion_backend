import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema configurado para tutores propuestos no es válido.');
  return `"${schema}"`;
}

export class CreateTutoresPropuestos20261002090000 implements MigrationInterface {
  name = 'CreateTutoresPropuestos20261002090000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`
      CREATE TABLE ${s}."tutor_propuesto" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "postulacion_id" uuid NOT NULL,
        "docente_id" uuid NOT NULL,
        "orden_prioridad" smallint NOT NULL,
        CONSTRAINT "PK_tutor_propuesto" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_tutor_propuesto_postulacion_docente" UNIQUE ("postulacion_id", "docente_id"),
        CONSTRAINT "UQ_tutor_propuesto_postulacion_prioridad" UNIQUE ("postulacion_id", "orden_prioridad"),
        CONSTRAINT "UQ_tutor_propuesto_id_docente" UNIQUE ("id", "docente_id"),
        CONSTRAINT "FK_tutor_propuesto_postulacion" FOREIGN KEY ("postulacion_id") REFERENCES ${s}."postulacion"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_tutor_propuesto_docente" FOREIGN KEY ("docente_id") REFERENCES ${s}."docente"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_tutor_propuesto_prioridad" CHECK ("orden_prioridad" BETWEEN 1 AND 32767)
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_tutor_propuesto_docente" ON ${s}."tutor_propuesto" ("docente_id", "postulacion_id")`);
    await queryRunner.query(`
      CREATE FUNCTION ${s}."validar_tutor_propuesto"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_activo text; v_rol text; v_habilitado boolean;
      BEGIN
        IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'las preferencias de tutores son históricas y no se modifican ni eliminan' USING ERRCODE='23514'; END IF;
        SELECT u."estado"::text, u."rol"::text, d."habilitado_tutoria"
          INTO v_activo, v_rol, v_habilitado
          FROM ${s}."docente" d JOIN ${s}."usuario" u ON u."id"=d."usuario_id"
          WHERE d."id"=NEW."docente_id" FOR UPDATE OF d,u;
        IF NOT FOUND OR v_activo <> 'ACTIVO' OR v_rol <> 'DOCENTE' OR v_habilitado IS DISTINCT FROM true THEN
          RAISE EXCEPTION 'el docente no está habilitado para tutoría' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$
    `);
    await queryRunner.query(`CREATE TRIGGER "TRG_tutor_propuesto_validate" BEFORE INSERT OR UPDATE OR DELETE ON ${s}."tutor_propuesto" FOR EACH ROW EXECUTE FUNCTION ${s}."validar_tutor_propuesto"()`);
    await queryRunner.query(`
      CREATE FUNCTION ${s}."validar_postulacion_con_tutores"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM ${s}."tutor_propuesto" WHERE "postulacion_id"=NEW."id") THEN
          RAISE EXCEPTION 'toda nueva postulación debe incluir al menos un tutor propuesto' USING ERRCODE='23514';
        END IF;
        RETURN NULL;
      END $$
    `);
    await queryRunner.query(`CREATE CONSTRAINT TRIGGER "TRG_postulacion_requiere_tutores" AFTER INSERT ON ${s}."postulacion" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${s}."validar_postulacion_con_tutores"()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."tutor_propuesto" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(`SELECT COUNT(*)::int AS total FROM ${s}."tutor_propuesto"`) as Array<{ total: number }>;
    if (Number(rows[0]?.total ?? 0) > 0) throw new Error('No se puede revertir la migración: tutor_propuesto contiene registros.');
    await queryRunner.query(`DROP TRIGGER "TRG_postulacion_requiere_tutores" ON ${s}."postulacion"`);
    await queryRunner.query(`DROP TRIGGER "TRG_tutor_propuesto_validate" ON ${s}."tutor_propuesto"`);
    await queryRunner.query(`DROP FUNCTION ${s}."validar_postulacion_con_tutores"()`);
    await queryRunner.query(`DROP FUNCTION ${s}."validar_tutor_propuesto"()`);
    await queryRunner.query(`DROP TABLE ${s}."tutor_propuesto"`);
  }
}
