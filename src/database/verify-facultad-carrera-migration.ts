import { randomBytes } from 'node:crypto';
import { QueryFailedError } from 'typeorm';
import { loadEnvironment } from '../config/load-environment.js';
import { CATALOGO_FACULTAD_CARRERA } from './catalogo-facultad-carrera.js';
import { DatabaseDataSource } from './database-data-source.js';
import { createDatabaseOptions } from './database.options.js';

const schema = `test_faccar_${randomBytes(8).toString('hex')}`;
const schemaSql = (): string => {
  if (!/^test_faccar_[a-f0-9]{16}$/.test(schema)) throw new Error('El esquema temporal no es válido.');
  return `"${schema}"`;
};
let admin: DatabaseDataSource | undefined;
let isolated: DatabaseDataSource | undefined;
let created = false;
let step = 'conexión y migraciones';

const code = (error: unknown) => error instanceof QueryFailedError ? (error.driverError as { code?: string }).code : undefined;

async function verify(): Promise<void> {
  const options = createDatabaseOptions(loadEnvironment());
  admin = new DatabaseDataSource({ ...options, schema: 'public', entities: [], migrations: [] });
  await admin.initialize();
  await admin.query(`CREATE SCHEMA ${schemaSql()}`);
  created = true;
  isolated = new DatabaseDataSource({ ...options, schema, entities: [] });
  await isolated.initialize();
  await isolated.runMigrations({ transaction: 'all' });
  const db = isolated;
  const s = schemaSql();

  step = 'catálogo sembrado';
  const sembradas = await db.query(`SELECT f."codigo", count(c."id")::int AS carreras FROM ${s}."facultad" f LEFT JOIN ${s}."carrera" c ON c."facultad_id" = f."id" GROUP BY f."codigo"`) as Array<{ codigo: string; carreras: number }>;
  const esperado = new Map(CATALOGO_FACULTAD_CARRERA.map((f) => [f.codigo, f.carreras.length]));
  if (sembradas.length !== 7 || sembradas.some((row) => esperado.get(row.codigo) !== Number(row.carreras))) {
    throw new Error('El catálogo sembrado no coincide con las 7 facultades y sus carreras.');
  }

  step = 'columnas obligatorias';
  const columnas = await db.query(`SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND ((table_name = 'periodo_titulacion' AND column_name = 'facultad_id') OR (table_name IN ('tema','docente','estudiante','preparacion_importacion') AND column_name = 'carrera_id') OR (table_name = 'docente' AND column_name = 'departamento') OR (table_name = 'estudiante' AND column_name = 'carrera')) ORDER BY table_name`, [schema]) as Array<{ table_name: string; column_name: string; is_nullable: string }>;
  const obligatorias = columnas.filter((c) => c.table_name !== 'preparacion_importacion');
  if (obligatorias.length !== 4 || obligatorias.some((c) => c.is_nullable !== 'NO' || !['facultad_id', 'carrera_id'].includes(c.column_name))) {
    throw new Error('facultad_id/carrera_id no son NOT NULL o siguen existiendo departamento/carrera de texto.');
  }
  if (columnas.find((c) => c.table_name === 'preparacion_importacion')?.is_nullable !== 'YES') throw new Error('preparacion_importacion.carrera_id debe admitir NULL.');

  step = 'claves foráneas';
  const fks = await db.query(`SELECT constraint_name FROM information_schema.table_constraints WHERE table_schema = $1 AND constraint_type = 'FOREIGN KEY' AND constraint_name = ANY($2::text[])`, [schema, ['FK_carrera_facultad', 'FK_periodo_titulacion_facultad', 'FK_tema_carrera', 'FK_docente_carrera', 'FK_estudiante_carrera', 'FK_preparacion_importacion_carrera']]) as unknown[];
  if (fks.length !== 6) throw new Error('Faltan claves foráneas del catálogo.');

  step = 'unicidad por facultad';
  let duplicada = false;
  try { await db.query(`INSERT INTO ${s}."carrera" ("codigo","nombre","facultad_id") SELECT 'DUPLICADA', "nombre", "facultad_id" FROM ${s}."carrera" WHERE "codigo" = 'PSICOLOGIA'`); }
  catch (error: unknown) { duplicada = code(error) === '23505'; }
  if (!duplicada) throw new Error('Se aceptó una carrera repetida en la misma facultad.');

  step = 'reversión protegida';
  await db.query(`INSERT INTO ${s}."periodo_titulacion" ("codigo","nombre","fecha_inicio_postulacion","fecha_fin_postulacion","fecha_inicio_titulacion","max_integrantes_default","facultad_id") SELECT 'VERIFY','Verificación','2026-01-01','2026-02-01','2026-02-01',3,"id" FROM ${s}."facultad" ORDER BY "codigo" LIMIT 1`);
  let protegida = false;
  try { await db.undoLastMigration({ transaction: 'all' }); }
  catch (error: unknown) { protegida = error instanceof Error && error.message.includes('contiene registros'); }
  if (!protegida) throw new Error('La reversión no protegió los períodos existentes.');

  step = 'reversión sin datos';
  await db.query(`DELETE FROM ${s}."periodo_titulacion"`);
  await db.undoLastMigration({ transaction: 'all' });
  const restauradas = await db.query(`SELECT to_regclass($1) AS facultad, (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = $2 AND table_name = 'docente' AND column_name = 'departamento') AS departamento`, [`${schema}.facultad`, schema]) as Array<{ facultad: string | null; departamento: number }>;
  if (restauradas[0]?.facultad !== null || Number(restauradas[0]?.departamento) !== 1) throw new Error('La reversión no restauró el esquema anterior.');
}

async function cleanup(): Promise<void> {
  let failed = false;
  if (isolated?.isInitialized) { try { await isolated.destroy(); } catch { failed = true; } }
  if (created && admin?.isInitialized) { try { await admin.query(`DROP SCHEMA ${schemaSql()} CASCADE`); } catch { failed = true; } }
  if (admin?.isInitialized) { try { await admin.destroy(); } catch { failed = true; } }
  if (failed) throw new Error('No se pudo eliminar el esquema temporal.');
}

let verified = false;
try { await verify(); verified = true; }
catch (error: unknown) {
  const detail = error instanceof QueryFailedError ? `PostgreSQL ${code(error) ?? 'desconocido'}` : error instanceof Error ? error.message : 'error desconocido';
  console.error(`Falló la verificación del catálogo de facultades y carreras en ${step}: ${detail}. No se modificó el esquema configurado.`);
  process.exitCode = 1;
} finally { try { await cleanup(); } catch { console.error('No se pudo limpiar el esquema temporal del catálogo.'); process.exitCode = 1; } }

if (verified && process.exitCode !== 1) console.info('Migración del catálogo de facultades y carreras (siembra, NOT NULL, claves foráneas y reversión protegida) verificada en esquema temporal.');
