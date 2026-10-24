import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const options = queryRunner.connection.options as PostgresConnectionOptions;
  const schema = options.schema ?? 'public';
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) {
    throw new Error('El esquema configurado para habilitaciones no es válido.');
  }
  return `"${schema}"`;
}

export class CreateHabilitados20261002030000 implements MigrationInterface {
  name = 'CreateHabilitados20261002030000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`CREATE TYPE ${s}."lote_importacion_tipo_enum" AS ENUM ('ESTUDIANTES', 'DOCENTES')`);
    await queryRunner.query(`CREATE TYPE ${s}."lote_importacion_estado_enum" AS ENUM ('EN_PROCESO', 'COMPLETADO', 'COMPLETADO_CON_ERRORES', 'FALLIDO')`);
    await queryRunner.query(`CREATE TYPE ${s}."estudiante_habilitado_origen_enum" AS ENUM ('MANUAL', 'IMPORTACION', 'SINCRONIZACION')`);
    await queryRunner.query(`CREATE TYPE ${s}."estudiante_habilitado_estado_enum" AS ENUM ('HABILITADO', 'SUSPENDIDO')`);
    await queryRunner.query(`CREATE TYPE ${s}."estudiante_habilitado_condicion_enum" AS ENUM ('REGULAR', 'CONDICIONADO')`);
    await queryRunner.query(`CREATE TYPE ${s}."estudiante_habilitado_situacion_enum" AS ENUM ('PENDIENTE', 'ADMITIDO', 'NO_ADMITIDO')`);

    await queryRunner.query(`
      CREATE TABLE ${s}."lote_importacion" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "periodo_id" uuid NULL,
        "ejecutado_por_id" uuid NOT NULL,
        "tipo" ${s}."lote_importacion_tipo_enum" NOT NULL,
        "nombre_archivo" varchar(200) NOT NULL,
        "ruta_almacenamiento" varchar(500) NOT NULL,
        "estado" ${s}."lote_importacion_estado_enum" NOT NULL,
        "total_filas" integer NOT NULL DEFAULT 0,
        "filas_ok" integer NOT NULL DEFAULT 0,
        "filas_error" integer NOT NULL DEFAULT 0,
        "errores" jsonb NULL,
        "fecha_inicio" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "fecha_fin" timestamptz NULL,
        CONSTRAINT "PK_lote_importacion" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lote_importacion_periodo" FOREIGN KEY ("periodo_id") REFERENCES ${s}."periodo_titulacion"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_lote_importacion_usuario" FOREIGN KEY ("ejecutado_por_id") REFERENCES ${s}."usuario"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_lote_importacion_contadores" CHECK ("total_filas" >= 0 AND "filas_ok" >= 0 AND "filas_error" >= 0),
        CONSTRAINT "CHK_lote_importacion_total_finalizado" CHECK ("estado" = 'EN_PROCESO' OR ("filas_ok" + "filas_error" = "total_filas")),
        CONSTRAINT "CHK_lote_importacion_periodo_estudiantes" CHECK ("tipo" <> 'ESTUDIANTES' OR "periodo_id" IS NOT NULL),
        CONSTRAINT "CHK_lote_importacion_fechas" CHECK (("estado" = 'EN_PROCESO' AND "fecha_fin" IS NULL) OR ("estado" <> 'EN_PROCESO' AND "fecha_fin" IS NOT NULL))
      )
    `);
    await queryRunner.query(`
      CREATE TABLE ${s}."estudiante_habilitado" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "periodo_id" uuid NOT NULL,
        "estudiante_id" uuid NOT NULL,
        "origen" ${s}."estudiante_habilitado_origen_enum" NOT NULL,
        "lote_importacion_id" uuid NULL,
        "estado" ${s}."estudiante_habilitado_estado_enum" NOT NULL DEFAULT 'HABILITADO',
        "condicion_ingreso" ${s}."estudiante_habilitado_condicion_enum" NOT NULL,
        "requisito_pendiente" text NULL,
        "situacion_ingreso" ${s}."estudiante_habilitado_situacion_enum" NOT NULL,
        "fecha_habilitacion" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "fecha_resolucion_ingreso" timestamptz NULL,
        "resuelto_por_id" uuid NULL,
        "observacion_ingreso" text NULL,
        CONSTRAINT "PK_estudiante_habilitado" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_estudiante_habilitado_periodo_estudiante" UNIQUE ("periodo_id", "estudiante_id"),
        CONSTRAINT "FK_habilitado_periodo" FOREIGN KEY ("periodo_id") REFERENCES ${s}."periodo_titulacion"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_habilitado_estudiante" FOREIGN KEY ("estudiante_id") REFERENCES ${s}."estudiante"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_habilitado_lote_importacion" FOREIGN KEY ("lote_importacion_id") REFERENCES ${s}."lote_importacion"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_habilitado_resuelto_por" FOREIGN KEY ("resuelto_por_id") REFERENCES ${s}."usuario"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_habilitado_regular_requisito" CHECK (("condicion_ingreso" = 'REGULAR') = ("requisito_pendiente" IS NULL)),
        CONSTRAINT "CHK_habilitado_requisito_no_vacio" CHECK ("requisito_pendiente" IS NULL OR length(btrim("requisito_pendiente")) > 0),
        CONSTRAINT "CHK_habilitado_regular_situacion" CHECK ("condicion_ingreso" <> 'REGULAR' OR "situacion_ingreso" <> 'PENDIENTE'),
        CONSTRAINT "CHK_habilitado_condicionado_resuelto" CHECK (("situacion_ingreso" = 'PENDIENTE' AND "fecha_resolucion_ingreso" IS NULL AND "resuelto_por_id" IS NULL) OR ("situacion_ingreso" <> 'PENDIENTE' AND "fecha_resolucion_ingreso" IS NOT NULL AND "resuelto_por_id" IS NOT NULL)),
        CONSTRAINT "CHK_habilitado_origen_lote" CHECK (("origen" = 'IMPORTACION') = ("lote_importacion_id" IS NOT NULL))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_habilitado_periodo_fecha" ON ${s}."estudiante_habilitado" ("periodo_id", "fecha_habilitacion" DESC, "id" ASC)`);
    await queryRunner.query(`
      CREATE TABLE ${s}."auditoria" (
        "id" BIGSERIAL NOT NULL,
        "usuario_id" uuid NOT NULL,
        "accion" varchar(60) NOT NULL,
        "entidad_tipo" varchar(60) NOT NULL,
        "entidad_id" uuid NOT NULL,
        "valores_anteriores" jsonb NULL,
        "valores_nuevos" jsonb NULL,
        "ip_origen" inet NULL,
        "fecha_hora" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_auditoria" PRIMARY KEY ("id"),
        CONSTRAINT "FK_auditoria_usuario" FOREIGN KEY ("usuario_id") REFERENCES ${s}."usuario"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_auditoria_entidad" ON ${s}."auditoria" ("entidad_tipo", "entidad_id", "fecha_hora" DESC)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."auditoria", ${s}."estudiante_habilitado", ${s}."lote_importacion" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(`SELECT
      (SELECT COUNT(*) FROM ${s}."auditoria")::int AS auditoria,
      (SELECT COUNT(*) FROM ${s}."estudiante_habilitado")::int AS habilitados,
      (SELECT COUNT(*) FROM ${s}."lote_importacion")::int AS lotes` ) as Array<{ auditoria: number; habilitados: number; lotes: number }>;
    if (Number(rows[0]?.auditoria ?? 0) + Number(rows[0]?.habilitados ?? 0) + Number(rows[0]?.lotes ?? 0) > 0) {
      throw new Error('No se puede revertir la migración: existen habilitaciones, lotes o auditorías.');
    }
    await queryRunner.query(`DROP TABLE ${s}."auditoria"`);
    await queryRunner.query(`DROP TABLE ${s}."estudiante_habilitado"`);
    await queryRunner.query(`DROP TABLE ${s}."lote_importacion"`);
    await queryRunner.query(`DROP TYPE ${s}."estudiante_habilitado_situacion_enum"`);
    await queryRunner.query(`DROP TYPE ${s}."estudiante_habilitado_condicion_enum"`);
    await queryRunner.query(`DROP TYPE ${s}."estudiante_habilitado_estado_enum"`);
    await queryRunner.query(`DROP TYPE ${s}."estudiante_habilitado_origen_enum"`);
    await queryRunner.query(`DROP TYPE ${s}."lote_importacion_estado_enum"`);
    await queryRunner.query(`DROP TYPE ${s}."lote_importacion_tipo_enum"`);
  }
}
