import { randomBytes } from 'node:crypto';
import { QueryFailedError } from 'typeorm';
import { DatabaseDataSource } from './database-data-source.js';
import { createDatabaseOptions } from './database.options.js';
import { loadEnvironment } from '../config/load-environment.js';

const schema = `test_impdoc_${randomBytes(8).toString('hex')}`;
const schemaSql = (): string => {
  if (!/^test_impdoc_[a-f0-9]{16}$/.test(schema)) throw new Error('El esquema temporal no es válido.');
  return `"${schema}"`;
};
let admin: DatabaseDataSource | undefined;
let isolated: DatabaseDataSource | undefined;
let created = false;
let step = 'conexión y migraciones';

const code = (error: unknown) => error instanceof QueryFailedError ? (error.driverError as { code?: string }).code : undefined;

async function expectCheck(statement: () => Promise<unknown>, message: string): Promise<void> {
  let rejected = false;
  try { await statement(); } catch (error: unknown) { rejected = code(error) === '23514'; }
  if (!rejected) throw new Error(message);
}

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

  step = 'datos de prueba';
  const userId = '00000000-0000-4000-8000-000000000001';
  const periodId = '00000000-0000-4000-8000-000000000002';
  await db.query(`INSERT INTO ${s}."usuario" ("id","email","nombres","apellidos","rol","estado","id_externo_sso") VALUES ($1,'verificador@uleam.edu.ec','Verificador','Importación','ADMIN','ACTIVO',NULL)`, [userId]);
  await db.query(`INSERT INTO ${s}."periodo_titulacion" ("id","codigo","nombre","fecha_inicio_postulacion","fecha_fin_postulacion","fecha_inicio_titulacion","estado","max_integrantes_default") VALUES ($1,'VERIFY','Verificación','2026-01-01','2026-02-01','2026-02-01','BORRADOR',3)`, [periodId]);
  const insert = (tipo: string | null, periodo: string | null) => db.query(
    `INSERT INTO ${s}."preparacion_importacion" ("periodo_id","solicitada_por_id","nombre_archivo","ruta_almacenamiento","sha256","estado","expira_en"${tipo ? ',"tipo"' : ''}) VALUES ($1,$2,'a.xlsx','clave',repeat('a',64),'VALIDANDO',now() + interval '1 hour'${tipo ? ',$3' : ''})`,
    tipo ? [periodo, userId, tipo] : [periodo, userId],
  );

  step = 'reglas de período por tipo';
  await insert(null, periodId);
  await insert('DOCENTES', null);
  await expectCheck(() => insert('DOCENTES', periodId), 'Se aceptó una importación de docentes asociada a un período.');
  await expectCheck(() => insert('ESTUDIANTES', null), 'Se aceptó una importación de estudiantes sin período.');
  await expectCheck(() => insert(null, null), 'El tipo por defecto (ESTUDIANTES) aceptó una preparación sin período.');
  await db.query(`INSERT INTO ${s}."lote_importacion" ("periodo_id","ejecutado_por_id","tipo","nombre_archivo","ruta_almacenamiento","estado","total_filas","filas_ok","filas_error","fecha_inicio") VALUES (NULL,$1,'DOCENTES','a.xlsx','clave','EN_PROCESO',1,0,0,now())`, [userId]);

  step = 'reversión protegida';
  let protectedDown = false;
  try { await db.undoLastMigration({ transaction: 'all' }); }
  catch (error: unknown) { protectedDown = error instanceof Error && error.message.includes('importación de docentes'); }
  if (!protectedDown) throw new Error('La reversión no protegió las preparaciones de docentes.');

  step = 'reversión sin historial de docentes';
  await db.query(`DELETE FROM ${s}."preparacion_importacion" WHERE "tipo" = 'DOCENTES'`);
  await db.undoLastMigration({ transaction: 'all' });
  const rows = await db.query(`SELECT is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'preparacion_importacion' AND column_name IN ('periodo_id','tipo') ORDER BY column_name`, [schema]) as Array<{ is_nullable: string }>;
  if (rows.length !== 1 || rows[0].is_nullable !== 'NO') throw new Error('La reversión no restauró periodo_id obligatorio ni eliminó tipo.');
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
  console.error(`Falló la verificación de la importación de docentes en ${step}: ${detail}. No se modificó el esquema configurado.`);
  process.exitCode = 1;
} finally { try { await cleanup(); } catch { console.error('No se pudo limpiar el esquema temporal de importación de docentes.'); process.exitCode = 1; } }

if (verified && process.exitCode !== 1) console.info('Migración de importación de docentes (tipo, período opcional por tipo y reversión protegida) verificada en esquema temporal.');
