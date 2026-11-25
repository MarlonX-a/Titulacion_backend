import type { MigrationInterface, QueryRunner } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

/**
 * Funciones de PAT cuyo control de período lista los estados admitidos. Se reemplaza solo la lista
 * `'POSTULACION_CERRADA','EN_CURSO'`, así que la lógica existente (incluida la excepción de equipos
 * ADMIN de 20261124160000 y 20261124170000) se conserva tal cual.
 */
const FUNCIONES = [
  'validar_contenido_pat_estudiante',
  'validar_generacion_pat_insert',
  'proteger_documento_pat',
] as const;

const ANTES = /'POSTULACION_CERRADA'\s*,\s*'EN_CURSO'/g;
const DESPUES = "'POSTULACION_ABIERTA','POSTULACION_CERRADA','EN_CURSO'";
const ANTES_INVERSA = /'POSTULACION_ABIERTA'\s*,\s*'POSTULACION_CERRADA'\s*,\s*'EN_CURSO'/g;
const DESPUES_INVERSA = "'POSTULACION_CERRADA','EN_CURSO'";

function schemaName(queryRunner: QueryRunner): string {
  const schema = (queryRunner.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema configurado para el PAT en postulación abierta no es válido.');
  return schema;
}

async function reemplazarListaEstados(queryRunner: QueryRunner, desde: RegExp, hasta: string, esquema: string, invertir: boolean): Promise<void> {
  for (const nombre of FUNCIONES) {
    const rows = await queryRunner.query(
      `SELECT pg_get_functiondef(p.oid) AS definicion FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = $1 AND p.proname = $2`,
      [esquema, nombre],
    ) as Array<{ definicion: string }>;
    if (!rows[0]) throw new Error(`No existe la función ${esquema}.${nombre}; no se puede aplicar la migración del PAT.`);
    const definicion = rows[0].definicion;
    const coincidencias = definicion.match(desde)?.length ?? 0;
    if (coincidencias === 0) throw new Error(`La función ${esquema}.${nombre} no tiene la lista de estados esperada.`);
    const nueva = definicion.replace(desde, hasta);
    // invertir solo cambia la lista; el resto de la definición queda igual
    if (invertir && nueva === definicion) throw new Error(`No se pudo revertir la lista de estados en ${esquema}.${nombre}.`);
    await queryRunner.query(nueva);
  }
}

/**
 * Generación, contenido y entrega del PAT del estudiante también con el período en POSTULACION_ABIERTA.
 * Los servicios ya lo admiten; aquí se alinean los triggers de PostgreSQL.
 */
export class PatPostulacionAbierta20261124180000 implements MigrationInterface {
  name = 'PatPostulacionAbierta20261124180000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await reemplazarListaEstados(queryRunner, ANTES, DESPUES, schemaName(queryRunner), false);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const esquema = schemaName(queryRunner);
    const abiertos = await queryRunner.query(
      `SELECT count(*)::int AS total FROM "${esquema}"."periodo_titulacion" WHERE "estado" = 'POSTULACION_ABIERTA'`,
    ) as Array<{ total: number }>;
    if (Number(abiertos[0]?.total ?? 0) > 0) {
      throw new Error('No se puede revertir la migración: existen períodos en POSTULACION_ABIERTA con el PAT habilitado.');
    }
    await reemplazarListaEstados(queryRunner, ANTES_INVERSA, DESPUES_INVERSA, esquema, true);
  }
}
