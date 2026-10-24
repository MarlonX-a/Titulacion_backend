import { randomBytes } from 'node:crypto';
import { DatabaseDataSource } from './database-data-source.js';
import { createDatabaseOptions } from './database.options.js';
import { loadEnvironment } from '../config/load-environment.js';

const schema = `test_auth_${randomBytes(8).toString('hex')}`;
const schemaSql = (): string => {
  if (!/^test_auth_[a-f0-9]{16}$/.test(schema)) throw new Error('El esquema temporal no es válido.');
  return `"${schema}"`;
};
let admin: DatabaseDataSource | undefined;
let isolated: DatabaseDataSource | undefined;
let created = false;
let step = 'conexión y migraciones';

async function verify(): Promise<void> {
  const options = createDatabaseOptions(loadEnvironment());
  admin = new DatabaseDataSource({ ...options, schema: 'public', entities: [], migrations: [] });
  await admin.initialize();
  await admin.query(`CREATE SCHEMA ${schemaSql()}`);
  created = true;
  isolated = new DatabaseDataSource({ ...options, schema, entities: [] });
  await isolated.initialize();
  await isolated.runMigrations({ transaction: 'all' });

  step = 'comprobación de nulabilidad';
  const nullable = await isolated.query(`SELECT is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'usuario' AND column_name = 'id_externo_sso'`, [schema]) as Array<{ is_nullable: string }>;
  if (nullable[0]?.is_nullable !== 'YES') throw new Error('id_externo_sso debe conservar el historial y admitir cuentas locales.');
  step = 'creación de cuenta de prueba';
  const id = '00000000-0000-4000-8000-000000000001';
  await isolated.query(`INSERT INTO ${schemaSql()}."usuario" ("id","email","nombres","apellidos","rol","estado","id_externo_sso") VALUES ($1,$2,$3,$4,$5,$6,NULL)`, [id, 'verificador@uleam.edu.ec', 'Verificador', 'Auth', 'ADMIN', 'ACTIVO']);
  step = 'comprobación de tablas';
  const tables = await isolated.query(`SELECT to_regclass($1) AS credenciales, to_regclass($2) AS sesiones, to_regclass($3) AS refresh, to_regclass($4) AS recovery, to_regclass($5) AS outbox, to_regclass($6) AS importaciones`, [ `${schema}.credencial_usuario`, `${schema}.sesion_usuario`, `${schema}.sesion_refresh_hash`, `${schema}.solicitud_recuperacion`, `${schema}.correo_salida`, `${schema}.preparacion_importacion` ]) as Array<Record<string, string | null>>;
  if (!tables[0]?.credenciales || !tables[0]?.sesiones || !tables[0]?.refresh || !tables[0]?.recovery || !tables[0]?.outbox || !tables[0]?.importaciones) throw new Error('Faltan tablas de autenticación u preparación de importación.');

  step = 'reversión protegida';
  await isolated.undoLastMigration();
  let protectedRollback = false;
  try { await isolated.undoLastMigration(); } catch (error: unknown) {
    protectedRollback = error instanceof Error && error.message.includes('cuentas creadas sin identificador SSO');
  }
  if (!protectedRollback) throw new Error('La reversión de autenticación no protegió una cuenta nueva sin SSO.');
  const preserved = await isolated.query(`SELECT COUNT(*)::int AS total FROM ${schemaSql()}."usuario" WHERE "id" = $1 AND "id_externo_sso" IS NULL`, [id]) as Array<{ total: number }>;
  if (Number(preserved[0]?.total ?? 0) !== 1) throw new Error('La reversión alteró una cuenta histórica del esquema de prueba.');
  process.stdout.write('Migraciones de autenticación e importación verificadas en esquema aislado; reversión protegida sin pérdida de cuentas.\n');
}

try {
  await verify();
} catch (error: unknown) {
  process.stderr.write(`Falló la verificación de autenticación (${step}): ${error instanceof Error ? error.message : 'error inesperado'}.\n`);
  process.exitCode = 1;
} finally {
  if (isolated?.isInitialized) await isolated.destroy().catch(() => undefined);
  if (admin?.isInitialized) {
    if (created) await admin.query(`DROP SCHEMA IF EXISTS ${schemaSql()} CASCADE`).catch(() => { process.exitCode = 1; });
    await admin.destroy().catch(() => { process.exitCode = 1; });
  }
}
