import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error('El esquema configurado para grupos no es válido.');
  return `"${schema}"`;
}

export class CreateGruposInvitaciones20261002060000 implements MigrationInterface {
  name = 'CreateGruposInvitaciones20261002060000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`CREATE TYPE ${s}."grupo_estado_enum" AS ENUM ('EN_CONFORMACION', 'ACTIVO', 'DISUELTO', 'ANULADO')`);
    await queryRunner.query(`CREATE TYPE ${s}."grupo_integrante_rol_enum" AS ENUM ('REPRESENTANTE', 'INTEGRANTE')`);
    await queryRunner.query(`CREATE TYPE ${s}."grupo_integrante_estado_enum" AS ENUM ('ACTIVO', 'RETIRADO')`);
    await queryRunner.query(`CREATE TYPE ${s}."invitacion_estado_enum" AS ENUM ('PENDIENTE', 'ACEPTADA', 'RECHAZADA', 'CANCELADA', 'EXPIRADA')`);
    await queryRunner.query(`
      CREATE TABLE ${s}."grupo" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "periodo_id" uuid NOT NULL,
        "nombre" varchar(120) NOT NULL,
        "estado" ${s}."grupo_estado_enum" NOT NULL DEFAULT 'EN_CONFORMACION',
        "creado_en" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_grupo" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_grupo_id_periodo" UNIQUE ("id", "periodo_id"),
        CONSTRAINT "FK_grupo_periodo" FOREIGN KEY ("periodo_id") REFERENCES ${s}."periodo_titulacion"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_grupo_nombre_no_vacio" CHECK (length(btrim("nombre")) > 0)
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_grupo_periodo_estado_creado" ON ${s}."grupo" ("periodo_id", "estado", "creado_en" DESC, "id" ASC)`);
    await queryRunner.query(`
      CREATE TABLE ${s}."grupo_integrante" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "grupo_id" uuid NOT NULL,
        "periodo_id" uuid NOT NULL,
        "estudiante_id" uuid NOT NULL,
        "rol_en_grupo" ${s}."grupo_integrante_rol_enum" NOT NULL,
        "estado" ${s}."grupo_integrante_estado_enum" NOT NULL DEFAULT 'ACTIVO',
        "fecha_ingreso" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "fecha_salida" timestamptz NULL,
        "motivo_salida" text NULL,
        CONSTRAINT "PK_grupo_integrante" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_grupo_integrante_grupo_estudiante" UNIQUE ("grupo_id", "estudiante_id"),
        CONSTRAINT "FK_grupo_integrante_grupo_periodo" FOREIGN KEY ("grupo_id", "periodo_id") REFERENCES ${s}."grupo"("id", "periodo_id") ON DELETE RESTRICT,
        CONSTRAINT "FK_grupo_integrante_habilitacion" FOREIGN KEY ("periodo_id", "estudiante_id") REFERENCES ${s}."estudiante_habilitado"("periodo_id", "estudiante_id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_grupo_integrante_estado_salida" CHECK (("estado" = 'ACTIVO') = ("fecha_salida" IS NULL)),
        CONSTRAINT "CHK_grupo_integrante_motivo_salida" CHECK ("motivo_salida" IS NULL OR length(btrim("motivo_salida")) > 0)
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_grupo_integrante_periodo_estudiante_activo" ON ${s}."grupo_integrante" ("periodo_id", "estudiante_id") WHERE "estado" = 'ACTIVO'`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_grupo_integrante_representante_activo" ON ${s}."grupo_integrante" ("grupo_id") WHERE "rol_en_grupo" = 'REPRESENTANTE' AND "estado" = 'ACTIVO'`);
    await queryRunner.query(`CREATE INDEX "IDX_grupo_integrante_grupo_estado" ON ${s}."grupo_integrante" ("grupo_id", "estado")`);
    await queryRunner.query(`
      CREATE TABLE ${s}."invitacion" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "grupo_id" uuid NOT NULL,
        "periodo_id" uuid NOT NULL,
        "estudiante_emisor_id" uuid NOT NULL,
        "estudiante_destino_id" uuid NOT NULL,
        "estado" ${s}."invitacion_estado_enum" NOT NULL DEFAULT 'PENDIENTE',
        "fecha_envio" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "expira_en" timestamptz NOT NULL,
        "fecha_respuesta" timestamptz NULL,
        CONSTRAINT "PK_invitacion" PRIMARY KEY ("id"),
        CONSTRAINT "FK_invitacion_grupo_periodo" FOREIGN KEY ("grupo_id", "periodo_id") REFERENCES ${s}."grupo"("id", "periodo_id") ON DELETE RESTRICT,
        CONSTRAINT "FK_invitacion_emisor_habilitado" FOREIGN KEY ("periodo_id", "estudiante_emisor_id") REFERENCES ${s}."estudiante_habilitado"("periodo_id", "estudiante_id") ON DELETE RESTRICT,
        CONSTRAINT "FK_invitacion_destinatario_habilitado" FOREIGN KEY ("periodo_id", "estudiante_destino_id") REFERENCES ${s}."estudiante_habilitado"("periodo_id", "estudiante_id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_invitacion_distintos_estudiantes" CHECK ("estudiante_emisor_id" <> "estudiante_destino_id"),
        CONSTRAINT "CHK_invitacion_vencimiento" CHECK ("expira_en" > "fecha_envio"),
        CONSTRAINT "CHK_invitacion_estado_fecha_respuesta" CHECK (("estado" = 'PENDIENTE' AND "fecha_respuesta" IS NULL) OR ("estado" <> 'PENDIENTE' AND "fecha_respuesta" IS NOT NULL))
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_invitacion_pendiente_grupo_destinatario" ON ${s}."invitacion" ("grupo_id", "estudiante_destino_id") WHERE "estado" = 'PENDIENTE'`);
    await queryRunner.query(`CREATE INDEX "IDX_invitacion_periodo_destino_fecha" ON ${s}."invitacion" ("periodo_id", "estudiante_destino_id", "fecha_envio" DESC)`);
    await queryRunner.query(`CREATE INDEX "IDX_invitacion_grupo_fecha" ON ${s}."invitacion" ("grupo_id", "fecha_envio" DESC)`);
    await queryRunner.query(`
      CREATE FUNCTION ${s}."validar_integridad_grupo"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_grupo_id uuid; v_estado text; v_periodo_id uuid; v_max smallint; v_total integer; v_representantes integer;
      BEGIN
        v_grupo_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END;
        IF TG_TABLE_NAME = 'grupo_integrante' THEN
          v_grupo_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."grupo_id" ELSE NEW."grupo_id" END;
        END IF;
        SELECT g."estado"::text, g."periodo_id", p."max_integrantes_default"
          INTO v_estado, v_periodo_id, v_max
          FROM ${s}."grupo" g JOIN ${s}."periodo_titulacion" p ON p."id" = g."periodo_id"
          WHERE g."id" = v_grupo_id;
        IF NOT FOUND THEN RETURN NULL; END IF;
        SELECT count(*) FILTER (WHERE "estado" = 'ACTIVO'), count(*) FILTER (WHERE "estado" = 'ACTIVO' AND "rol_en_grupo" = 'REPRESENTANTE')
          INTO v_total, v_representantes FROM ${s}."grupo_integrante" WHERE "grupo_id" = v_grupo_id;
        IF v_estado IN ('EN_CONFORMACION', 'ACTIVO') AND v_representantes <> 1 THEN
          RAISE EXCEPTION 'grupo debe terminar la transacción con un representante activo' USING ERRCODE = '23514';
        END IF;
        IF v_estado = 'ACTIVO' AND v_total < 2 THEN
          RAISE EXCEPTION 'grupo activo requiere al menos dos integrantes' USING ERRCODE = '23514';
        END IF;
        IF v_total > v_max THEN
          RAISE EXCEPTION 'grupo supera el máximo de integrantes del período' USING ERRCODE = '23514';
        END IF;
        RETURN NULL;
      END $$
    `);
    await queryRunner.query(`CREATE CONSTRAINT TRIGGER "TRG_grupo_integridad_grupo" AFTER INSERT OR UPDATE OR DELETE ON ${s}."grupo" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${s}."validar_integridad_grupo"()`);
    await queryRunner.query(`CREATE CONSTRAINT TRIGGER "TRG_grupo_integridad_integrante" AFTER INSERT OR UPDATE OR DELETE ON ${s}."grupo_integrante" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${s}."validar_integridad_grupo"()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`LOCK TABLE ${s}."invitacion", ${s}."grupo_integrante", ${s}."grupo" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(`SELECT (SELECT count(*) FROM ${s}."grupo")::int AS grupos, (SELECT count(*) FROM ${s}."grupo_integrante")::int AS integrantes, (SELECT count(*) FROM ${s}."invitacion")::int AS invitaciones`) as Array<{ grupos: number; integrantes: number; invitaciones: number }>;
    if (Number(rows[0]?.grupos ?? 0) + Number(rows[0]?.integrantes ?? 0) + Number(rows[0]?.invitaciones ?? 0) > 0) {
      throw new Error('No se puede revertir la migración: grupos o invitaciones contienen registros.');
    }
    await queryRunner.query(`DROP TABLE ${s}."invitacion"`);
    await queryRunner.query(`DROP TABLE ${s}."grupo_integrante"`);
    await queryRunner.query(`DROP TABLE ${s}."grupo"`);
    await queryRunner.query(`DROP FUNCTION ${s}."validar_integridad_grupo"()`);
    await queryRunner.query(`DROP TYPE ${s}."invitacion_estado_enum"`);
    await queryRunner.query(`DROP TYPE ${s}."grupo_integrante_estado_enum"`);
    await queryRunner.query(`DROP TYPE ${s}."grupo_integrante_rol_enum"`);
    await queryRunner.query(`DROP TYPE ${s}."grupo_estado_enum"`);
  }
}
