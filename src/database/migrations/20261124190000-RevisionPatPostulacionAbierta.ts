import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

/**
 * Trigger de revisiones PAT: solo cambia la lista de estados de período que admite una revisión
 * (`'POSTULACION_CERRADA','EN_CURSO'` → incluye `'POSTULACION_ABIERTA'`). El resto de la definición,
 * incluido el control de rol ADMIN y la asignación VIGENTE, queda igual.
 */
const FUNCION = 'proteger_revision_pat';
const ANTES = /'POSTULACION_CERRADA'\s*,\s*'EN_CURSO'/g;
const DESPUES = "'POSTULACION_ABIERTA','POSTULACION_CERRADA','EN_CURSO'";
const ANTES_INVERSA = /'POSTULACION_ABIERTA'\s*,\s*'POSTULACION_CERRADA'\s*,\s*'EN_CURSO'/g;
const DESPUES_INVERSA = "'POSTULACION_CERRADA','EN_CURSO'";

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema configurado para las revisiones PAT en postulación abierta no es válido.');
  return schema;
}

async function reemplazarLista(queryRunner: QueryRunner, desde: RegExp, hasta: string, esquema: string): Promise<void> {
  const rows = await queryRunner.query(
    `SELECT pg_get_functiondef(p.oid) AS definicion FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = $1 AND p.proname = $2`,
    [esquema, FUNCION],
  ) as Array<{ definicion: string }>;
  if (!rows[0]) throw new Error(`No existe la función ${esquema}.${FUNCION}; no se puede aplicar la migración de revisiones PAT.`);
  const definicion = rows[0].definicion;
  if (!definicion.match(desde)) throw new Error(`La función ${esquema}.${FUNCION} no tiene la lista de estados esperada.`);
  await queryRunner.query(definicion.replace(desde, hasta));
}

/** Las revisiones del PAT también pueden hacerse con el período en POSTULACION_ABIERTA. */
export class RevisionPatPostulacionAbierta20261124190000 implements MigrationInterface {
  name = 'RevisionPatPostulacionAbierta20261124190000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await reemplazarLista(queryRunner, ANTES, DESPUES, schemaName(queryRunner));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const esquema = schemaName(queryRunner);
    const abiertos = await queryRunner.query(
      `SELECT count(*)::int AS total FROM "${esquema}"."periodo_titulacion" WHERE "estado" = 'POSTULACION_ABIERTA'`,
    ) as Array<{ total: number }>;
    if (Number(abiertos[0]?.total ?? 0) > 0) {
      throw new Error('No se puede revertir la migración: existen períodos en POSTULACION_ABIERTA con revisiones PAT habilitadas.');
    }
    await reemplazarLista(queryRunner, ANTES_INVERSA, DESPUES_INVERSA, esquema);
  }
}
