import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema configurado para los programas no es válido.');
  return `"${schema}"`;
}

/**
 * Rebuilds usuario_rol_enum (ALTER TYPE ... ADD VALUE cannot be used inside the migration
 * transaction, see 20261106100000-BancoTemas). Only `usuario.rol` uses the type; trigger functions
 * compare it as text, so they keep working.
 */
async function reconstruirRol(queryRunner: QueryRunner, s: string, valores: string[]): Promise<void> {
  await queryRunner.query(`ALTER TYPE ${s}."usuario_rol_enum" RENAME TO "usuario_rol_enum_old"`);
  await queryRunner.query(`CREATE TYPE ${s}."usuario_rol_enum" AS ENUM (${valores.map((v) => `'${v}'`).join(', ')})`);
  await queryRunner.query(`ALTER TABLE ${s}."usuario" ALTER COLUMN "rol" TYPE ${s}."usuario_rol_enum" USING "rol"::text::${s}."usuario_rol_enum"`);
  await queryRunner.query(`DROP TYPE ${s}."usuario_rol_enum_old"`);
}

/**
 * Block 4 (design 2026-11-15): programas group topics of a career under one responsible person (a
 * DOCENTE profile or a COORDINADOR account) with a topic limit; new role COORDINADOR.
 */
export class ProgramasCoordinador20261115110000 implements MigrationInterface {
  name = 'ProgramasCoordinador20261115110000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."usuario", ${s}."tema" IN ACCESS EXCLUSIVE MODE`);
    await reconstruirRol(queryRunner, s, ['ESTUDIANTE', 'DOCENTE', 'ADMIN', 'COORDINADOR']);

    await queryRunner.query(`
      CREATE TABLE ${s}."programa" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "nombre" varchar(150) NOT NULL,
        "descripcion" text NULL,
        "carrera_id" uuid NOT NULL,
        "responsable_docente_id" uuid NULL,
        "responsable_usuario_id" uuid NULL,
        "max_temas" smallint NOT NULL DEFAULT 15,
        "activo" boolean NOT NULL DEFAULT true,
        "creado_en" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "actualizado_en" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_programa" PRIMARY KEY ("id"),
        CONSTRAINT "FK_programa_carrera" FOREIGN KEY ("carrera_id") REFERENCES ${s}."carrera"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_programa_responsable_docente" FOREIGN KEY ("responsable_docente_id") REFERENCES ${s}."docente"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_programa_responsable_usuario" FOREIGN KEY ("responsable_usuario_id") REFERENCES ${s}."usuario"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_programa_un_responsable" CHECK (num_nonnulls("responsable_docente_id", "responsable_usuario_id") = 1),
        CONSTRAINT "CHK_programa_max_temas" CHECK ("max_temas" BETWEEN 1 AND 50),
        CONSTRAINT "CHK_programa_nombre_no_vacio" CHECK (length(btrim("nombre")) > 0)
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_programa_carrera_nombre" ON ${s}."programa" ("carrera_id", lower(btrim("nombre")))`);
    await queryRunner.query(`CREATE INDEX "IDX_programa_responsable_docente" ON ${s}."programa" ("responsable_docente_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_programa_responsable_usuario" ON ${s}."programa" ("responsable_usuario_id")`);

    await queryRunner.query(`ALTER TABLE ${s}."tema" ADD COLUMN "programa_id" uuid NULL, ADD COLUMN "categoria" varchar(120) NULL`);
    await queryRunner.query(`ALTER TABLE ${s}."tema" ADD CONSTRAINT "FK_tema_programa" FOREIGN KEY ("programa_id") REFERENCES ${s}."programa"("id") ON DELETE RESTRICT`);
    await queryRunner.query(`ALTER TABLE ${s}."tema" ADD CONSTRAINT "CHK_tema_categoria_no_vacia" CHECK ("categoria" IS NULL OR length(btrim("categoria")) > 0)`);
    await queryRunner.query(`CREATE INDEX "IDX_tema_programa" ON ${s}."tema" ("programa_id")`);

    // Programa: the COORDINADOR responsible must hold that role; limits and career cannot invalidate existing topics.
    await queryRunner.query(`
      CREATE FUNCTION ${s}."validar_programa"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_rol text; v_temas integer;
      BEGIN
        IF NEW."responsable_usuario_id" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."responsable_usuario_id" IS DISTINCT FROM OLD."responsable_usuario_id") THEN
          SELECT "rol"::text INTO v_rol FROM ${s}."usuario" WHERE "id" = NEW."responsable_usuario_id" FOR KEY SHARE;
          IF v_rol IS DISTINCT FROM 'COORDINADOR' THEN RAISE EXCEPTION 'el responsable del programa debe tener rol COORDINADOR' USING ERRCODE = '23514'; END IF;
        END IF;
        IF TG_OP = 'UPDATE' THEN
          SELECT count(*) INTO v_temas FROM ${s}."tema" WHERE "programa_id" = NEW."id" AND "estado" <> 'RETIRADO';
          IF v_temas > NEW."max_temas" THEN RAISE EXCEPTION 'el programa tiene más temas que el nuevo máximo' USING ERRCODE = '23514'; END IF;
          IF NEW."carrera_id" <> OLD."carrera_id" AND EXISTS (SELECT 1 FROM ${s}."tema" WHERE "programa_id" = NEW."id") THEN
            RAISE EXCEPTION 'no se puede cambiar la carrera de un programa con temas' USING ERRCODE = '23514';
          END IF;
        END IF;
        RETURN NEW;
      END $$
    `);
    await queryRunner.query(`CREATE TRIGGER "TRG_programa_validar" BEFORE INSERT OR UPDATE ON ${s}."programa" FOR EACH ROW EXECUTE FUNCTION ${s}."validar_programa"()`);

    // Tema: same career as its programa and at most max_temas non-RETIRADO topics (programa row locked).
    await queryRunner.query(`
      CREATE FUNCTION ${s}."validar_tema_programa"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_carrera uuid; v_max smallint; v_temas integer;
      BEGIN
        IF NEW."programa_id" IS NULL THEN RETURN NEW; END IF;
        SELECT "carrera_id", "max_temas" INTO v_carrera, v_max FROM ${s}."programa" WHERE "id" = NEW."programa_id" FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'programa inexistente' USING ERRCODE = '23503'; END IF;
        IF v_carrera <> NEW."carrera_id" THEN RAISE EXCEPTION 'la carrera del tema debe coincidir con la del programa' USING ERRCODE = '23514'; END IF;
        IF NEW."estado" <> 'RETIRADO' AND (TG_OP = 'INSERT' OR NEW."programa_id" IS DISTINCT FROM OLD."programa_id" OR OLD."estado" = 'RETIRADO') THEN
          SELECT count(*) INTO v_temas FROM ${s}."tema" WHERE "programa_id" = NEW."programa_id" AND "estado" <> 'RETIRADO' AND "id" <> NEW."id";
          IF v_temas + 1 > v_max THEN RAISE EXCEPTION 'el programa alcanzó su máximo de temas' USING ERRCODE = '23514'; END IF;
        END IF;
        RETURN NEW;
      END $$
    `);
    await queryRunner.query(`CREATE TRIGGER "TRG_tema_programa" BEFORE INSERT OR UPDATE OF "programa_id", "carrera_id", "estado" ON ${s}."tema" FOR EACH ROW EXECUTE FUNCTION ${s}."validar_tema_programa"()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."usuario", ${s}."tema", ${s}."programa" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(`SELECT (SELECT count(*) FROM ${s}."programa")::int AS programas, (SELECT count(*) FROM ${s}."usuario" WHERE "rol" = 'COORDINADOR')::int AS coordinadores, (SELECT count(*) FROM ${s}."tema" WHERE "categoria" IS NOT NULL)::int AS categorias`) as Array<{ programas: number; coordinadores: number; categorias: number }>;
    const datos = rows[0]!;
    if (Number(datos.programas) > 0 || Number(datos.coordinadores) > 0 || Number(datos.categorias) > 0) {
      throw new Error('No se puede revertir los programas: existen programas, cuentas COORDINADOR o temas con categoría.');
    }
    await queryRunner.query(`DROP TRIGGER "TRG_tema_programa" ON ${s}."tema"`);
    await queryRunner.query(`DROP FUNCTION ${s}."validar_tema_programa"()`);
    await queryRunner.query(`DROP INDEX ${s}."IDX_tema_programa"`);
    await queryRunner.query(`ALTER TABLE ${s}."tema" DROP CONSTRAINT "CHK_tema_categoria_no_vacia", DROP CONSTRAINT "FK_tema_programa"`);
    await queryRunner.query(`ALTER TABLE ${s}."tema" DROP COLUMN "categoria", DROP COLUMN "programa_id"`);
    await queryRunner.query(`DROP TABLE ${s}."programa"`);
    await queryRunner.query(`DROP FUNCTION ${s}."validar_programa"()`);
    await reconstruirRol(queryRunner, s, ['ESTUDIANTE', 'DOCENTE', 'ADMIN']);
  }
}
