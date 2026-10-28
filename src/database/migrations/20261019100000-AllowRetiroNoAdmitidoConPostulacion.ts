import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) {
    throw new Error('El esquema configurado para el retiro por no admisión no es válido.');
  }
  return `"${schema}"`;
}

/**
 * Allows the administrative withdrawal (ACTIVO -> RETIRADO) of a group member whose enablement was
 * resolved as NO_ADMITIDO even after the group registered a postulación. Every other composition
 * change on a group with postulaciones keeps being rejected with 23514.
 */
export class AllowRetiroNoAdmitidoConPostulacion20261019100000 implements MigrationInterface {
  name = 'AllowRetiroNoAdmitidoConPostulacion20261019100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION ${s}."proteger_composicion_postulacion"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_periodo uuid; v_grupo uuid; v_individual boolean;
      BEGIN
        v_periodo := CASE WHEN TG_OP='DELETE' THEN OLD."periodo_id" ELSE NEW."periodo_id" END;
        v_grupo := CASE WHEN TG_OP='DELETE' THEN OLD."grupo_id" ELSE NEW."grupo_id" END;
        PERFORM 1 FROM ${s}."periodo_titulacion" WHERE "id"=v_periodo FOR UPDATE;
        IF TG_OP='INSERT' THEN
          IF EXISTS (SELECT 1 FROM ${s}."postulacion" WHERE "grupo_id"=NEW."grupo_id") THEN RAISE EXCEPTION 'la composición del grupo está cerrada por una postulación' USING ERRCODE='23514'; END IF;
          SELECT EXISTS(SELECT 1 FROM ${s}."postulacion" WHERE "periodo_id"=NEW."periodo_id" AND "estudiante_id"=NEW."estudiante_id" AND "estado" IN ('PENDIENTE','EN_CONFLICTO','ACEPTADA')) INTO v_individual;
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
      END $$
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const s = schemaName(queryRunner);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION ${s}."proteger_composicion_postulacion"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_periodo uuid; v_grupo uuid; v_individual boolean;
      BEGIN
        v_periodo := CASE WHEN TG_OP='DELETE' THEN OLD."periodo_id" ELSE NEW."periodo_id" END;
        v_grupo := CASE WHEN TG_OP='DELETE' THEN OLD."grupo_id" ELSE NEW."grupo_id" END;
        PERFORM 1 FROM ${s}."periodo_titulacion" WHERE "id"=v_periodo FOR UPDATE;
        IF TG_OP='INSERT' THEN
          IF EXISTS (SELECT 1 FROM ${s}."postulacion" WHERE "grupo_id"=NEW."grupo_id") THEN RAISE EXCEPTION 'la composición del grupo está cerrada por una postulación' USING ERRCODE='23514'; END IF;
          SELECT EXISTS(SELECT 1 FROM ${s}."postulacion" WHERE "periodo_id"=NEW."periodo_id" AND "estudiante_id"=NEW."estudiante_id" AND "estado" IN ('PENDIENTE','EN_CONFLICTO','ACEPTADA')) INTO v_individual;
          IF v_individual THEN RAISE EXCEPTION 'estudiante con postulación individual activa' USING ERRCODE='23505'; END IF;
          RETURN NEW;
        END IF;
        IF TG_OP='UPDATE' AND NEW."grupo_id"=OLD."grupo_id" AND NEW."periodo_id"=OLD."periodo_id" AND NEW."estudiante_id"=OLD."estudiante_id" AND NEW."estado"=OLD."estado" AND NEW."fecha_ingreso"=OLD."fecha_ingreso" AND NEW."fecha_salida" IS NOT DISTINCT FROM OLD."fecha_salida" AND NEW."motivo_salida" IS NOT DISTINCT FROM OLD."motivo_salida" THEN
          RETURN NEW;
        END IF;
        IF EXISTS (SELECT 1 FROM ${s}."postulacion" WHERE "grupo_id"=v_grupo) THEN RAISE EXCEPTION 'la composición del grupo está cerrada por una postulación' USING ERRCODE='23514'; END IF;
        RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
      END $$
    `);
  }
}
