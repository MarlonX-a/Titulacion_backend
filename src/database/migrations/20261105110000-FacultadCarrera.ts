import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { CATALOGO_FACULTAD_CARRERA } from '../catalogo-facultad-carrera.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema configurado para facultades y carreras no es válido.');
  return `"${schema}"`;
}

const TABLAS_CON_DATOS = ['periodo_titulacion', 'tema', 'docente', 'estudiante'] as const;

async function exigirTablasVacias(queryRunner: QueryRunner, s: string, accion: string): Promise<void> {
  for (const tabla of TABLAS_CON_DATOS) {
    const rows = await queryRunner.query(`SELECT count(*)::int AS total FROM ${s}."${tabla}"`) as Array<{ total: number }>;
    if (Number(rows[0]?.total ?? 0) > 0) {
      throw new Error(`No se puede ${accion}: la tabla ${tabla} contiene registros. Reinicia el esquema de desarrollo con npm run db:reset-dev.`);
    }
  }
}

/**
 * Catálogo de facultades y carreras (diseño 2026-11-05). Solo existen datos de desarrollo: las
 * columnas nuevas son NOT NULL sin mapeo heredado, por eso exige tablas vacías.
 */
export class FacultadCarrera20261105110000 implements MigrationInterface {
  name = 'FacultadCarrera20261105110000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."periodo_titulacion", ${s}."docente", ${s}."estudiante", ${s}."tema", ${s}."preparacion_importacion" IN ACCESS EXCLUSIVE MODE`);
    await exigirTablasVacias(queryRunner, s, 'aplicar el catálogo de facultades y carreras');

    await queryRunner.query(`
      CREATE TABLE ${s}."facultad" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "codigo" character varying(80) NOT NULL,
        "nombre" character varying(150) NOT NULL,
        CONSTRAINT "PK_facultad" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_facultad_codigo" UNIQUE ("codigo"),
        CONSTRAINT "UQ_facultad_nombre" UNIQUE ("nombre"),
        CONSTRAINT "CHK_facultad_codigo_no_vacio" CHECK (length(btrim("codigo")) > 0),
        CONSTRAINT "CHK_facultad_nombre_no_vacio" CHECK (length(btrim("nombre")) > 0)
      )`);
    await queryRunner.query(`
      CREATE TABLE ${s}."carrera" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "codigo" character varying(80) NOT NULL,
        "nombre" character varying(150) NOT NULL,
        "facultad_id" uuid NOT NULL,
        CONSTRAINT "PK_carrera" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_carrera_codigo" UNIQUE ("codigo"),
        CONSTRAINT "UQ_carrera_facultad_nombre" UNIQUE ("facultad_id", "nombre"),
        CONSTRAINT "CHK_carrera_codigo_no_vacio" CHECK (length(btrim("codigo")) > 0),
        CONSTRAINT "CHK_carrera_nombre_no_vacio" CHECK (length(btrim("nombre")) > 0),
        CONSTRAINT "FK_carrera_facultad" FOREIGN KEY ("facultad_id") REFERENCES ${s}."facultad"("id") ON DELETE RESTRICT
      )`);

    for (const item of CATALOGO_FACULTAD_CARRERA) {
      const [row] = await queryRunner.query(`INSERT INTO ${s}."facultad" ("codigo","nombre") VALUES ($1,$2) RETURNING "id"`, [item.codigo, item.nombre]) as Array<{ id: string }>;
      for (const carrera of item.carreras) {
        await queryRunner.query(`INSERT INTO ${s}."carrera" ("codigo","nombre","facultad_id") VALUES ($1,$2,$3)`, [carrera.codigo, carrera.nombre, row.id]);
      }
    }

    await queryRunner.query(`ALTER TABLE ${s}."periodo_titulacion" ADD COLUMN "facultad_id" uuid NOT NULL, ADD CONSTRAINT "FK_periodo_titulacion_facultad" FOREIGN KEY ("facultad_id") REFERENCES ${s}."facultad"("id") ON DELETE RESTRICT`);
    await queryRunner.query(`CREATE INDEX "IDX_periodo_titulacion_facultad" ON ${s}."periodo_titulacion" ("facultad_id")`);
    await queryRunner.query(`ALTER TABLE ${s}."tema" ADD COLUMN "carrera_id" uuid NOT NULL, ADD CONSTRAINT "FK_tema_carrera" FOREIGN KEY ("carrera_id") REFERENCES ${s}."carrera"("id") ON DELETE RESTRICT`);
    await queryRunner.query(`CREATE INDEX "IDX_tema_carrera" ON ${s}."tema" ("carrera_id")`);
    await queryRunner.query(`ALTER TABLE ${s}."docente" DROP CONSTRAINT "CHK_docente_departamento_no_vacio", DROP COLUMN "departamento"`);
    await queryRunner.query(`ALTER TABLE ${s}."docente" ADD COLUMN "carrera_id" uuid NOT NULL, ADD CONSTRAINT "FK_docente_carrera" FOREIGN KEY ("carrera_id") REFERENCES ${s}."carrera"("id") ON DELETE RESTRICT`);
    await queryRunner.query(`CREATE INDEX "IDX_docente_carrera" ON ${s}."docente" ("carrera_id")`);
    await queryRunner.query(`ALTER TABLE ${s}."estudiante" DROP CONSTRAINT "CHK_estudiante_carrera_no_vacia", DROP COLUMN "carrera"`);
    await queryRunner.query(`ALTER TABLE ${s}."estudiante" ADD COLUMN "carrera_id" uuid NOT NULL, ADD CONSTRAINT "FK_estudiante_carrera" FOREIGN KEY ("carrera_id") REFERENCES ${s}."carrera"("id") ON DELETE RESTRICT`);
    await queryRunner.query(`CREATE INDEX "IDX_estudiante_carrera" ON ${s}."estudiante" ("carrera_id")`);
    await queryRunner.query(`ALTER TABLE ${s}."preparacion_importacion" ADD COLUMN "carrera_id" uuid NULL, ADD CONSTRAINT "FK_preparacion_importacion_carrera" FOREIGN KEY ("carrera_id") REFERENCES ${s}."carrera"("id") ON DELETE RESTRICT`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."periodo_titulacion", ${s}."docente", ${s}."estudiante", ${s}."tema", ${s}."preparacion_importacion" IN ACCESS EXCLUSIVE MODE`);
    await exigirTablasVacias(queryRunner, s, 'revertir el catálogo de facultades y carreras');
    const preparaciones = await queryRunner.query(`SELECT count(*)::int AS total FROM ${s}."preparacion_importacion" WHERE "carrera_id" IS NOT NULL`) as Array<{ total: number }>;
    if (Number(preparaciones[0]?.total ?? 0) > 0) throw new Error('No se puede revertir el catálogo de facultades y carreras: existen importaciones asociadas a una carrera.');
    await queryRunner.query(`ALTER TABLE ${s}."preparacion_importacion" DROP COLUMN "carrera_id"`);
    await queryRunner.query(`ALTER TABLE ${s}."estudiante" DROP COLUMN "carrera_id"`);
    await queryRunner.query(`ALTER TABLE ${s}."estudiante" ADD COLUMN "carrera" character varying(120) NOT NULL, ADD CONSTRAINT "CHK_estudiante_carrera_no_vacia" CHECK (length(btrim("carrera")) > 0)`);
    await queryRunner.query(`ALTER TABLE ${s}."docente" DROP COLUMN "carrera_id"`);
    await queryRunner.query(`ALTER TABLE ${s}."docente" ADD COLUMN "departamento" character varying(120) NULL, ADD CONSTRAINT "CHK_docente_departamento_no_vacio" CHECK ("departamento" IS NULL OR length(btrim("departamento")) > 0)`);
    await queryRunner.query(`ALTER TABLE ${s}."tema" DROP COLUMN "carrera_id"`);
    await queryRunner.query(`ALTER TABLE ${s}."periodo_titulacion" DROP COLUMN "facultad_id"`);
    await queryRunner.query(`DROP TABLE ${s}."carrera"`);
    await queryRunner.query(`DROP TABLE ${s}."facultad"`);
  }
}
