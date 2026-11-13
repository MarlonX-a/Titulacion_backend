import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema configurado para tutores propuestos no es válido.');
  return `"${schema}"`;
}

/**
 * Cuerpo de `validar_tutor_propuesto`. Fuera de la cláusula de bloqueo, el texto es idéntico al
 * de `20261002090000-CreateTutoresPropuestos` (incluidos espacios), de modo que `down()` deja
 * `prosrc` exactamente como lo dejó aquella migración.
 */
function definicion(s: string, bloqueo: 'FOR UPDATE OF d,u' | 'FOR SHARE OF d,u'): string {
  return `
      CREATE OR REPLACE FUNCTION ${s}."validar_tutor_propuesto"() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_activo text; v_rol text; v_habilitado boolean;
      BEGIN
        IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'las preferencias de tutores son históricas y no se modifican ni eliminan' USING ERRCODE='23514'; END IF;
        SELECT u."estado"::text, u."rol"::text, d."habilitado_tutoria"
          INTO v_activo, v_rol, v_habilitado
          FROM ${s}."docente" d JOIN ${s}."usuario" u ON u."id"=d."usuario_id"
          WHERE d."id"=NEW."docente_id" ${bloqueo};
        IF NOT FOUND OR v_activo <> 'ACTIVO' OR v_rol <> 'DOCENTE' OR v_habilitado IS DISTINCT FROM true THEN
          RAISE EXCEPTION 'el docente no está habilitado para tutoría' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$
    `;
}

/**
 * Proponer tutores ya no toma bloqueos de escritura sobre `docente` ni `usuario` (plan S3, M4).
 * El disparador pasa de `FOR UPDATE OF d,u` a `FOR SHARE OF d,u`, igual que el servicio:
 * varios estudiantes pueden proponer al mismo docente a la vez sin bloquearse ni provocar
 * interbloqueos (un bloqueo compartido del servicio seguido de uno exclusivo del disparador
 * producía 40P01), y un cambio administrativo concurrente del docente (desactivar la cuenta o
 * quitar `habilitado_tutoria`) sigue esperando a la propuesta o haciéndola fallar. Solo
 * reemplaza la función; no toca tablas ni datos.
 */
export class TutorPropuestoBloqueoCompartido20261112110000 implements MigrationInterface {
  name = 'TutorPropuestoBloqueoCompartido20261112110000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(definicion(schemaName(queryRunner), 'FOR SHARE OF d,u'));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(definicion(schemaName(queryRunner), 'FOR UPDATE OF d,u'));
  }
}
