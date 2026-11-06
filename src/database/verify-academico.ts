import type { DatabaseDataSource } from './database-data-source.js';

/**
 * Identificadores fijos para verificadores que ejecutan solo una parte de la cadena de migraciones
 * (sin catálogo). Permiten compilar; esos verificadores ya no reflejan el esquema actual.
 */
export const FACULTAD_VERIFICACION_ID = '00000000-0000-4000-8000-0000000000f1';
export const CARRERA_VERIFICACION_ID = '00000000-0000-4000-8000-0000000000c1';

/** Carrera y facultad sembradas por la migración del catálogo (esquemas con la cadena completa). */
export async function catalogoSembrado(db: DatabaseDataSource, schemaSql: string, codigoCarrera = 'INGENIERIA_EN_SOFTWARE'): Promise<{ carreraId: string; facultadId: string }> {
  const rows = await db.query(`SELECT "id", "facultad_id" FROM ${schemaSql}."carrera" WHERE "codigo" = $1`, [codigoCarrera]) as Array<{ id: string; facultad_id: string }>;
  if (!rows[0]) throw new Error(`No existe la carrera sembrada ${codigoCarrera}.`);
  return { carreraId: rows[0].id, facultadId: rows[0].facultad_id };
}
