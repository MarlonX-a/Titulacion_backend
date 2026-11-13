import { randomBytes } from 'node:crypto';
import { DatabaseDataSource } from './database-data-source.js';
import { createDatabaseOptions } from './database.options.js';
import { loadEnvironment } from '../config/load-environment.js';

/** Migración cuyo down() debe negarse a borrar cuentas creadas sin identificador SSO. */
const AUTH_MIGRATION = 'CreatePasswordAuthentication20261006100000';
const schema = `test_auth_${randomBytes(8).toString('hex')}`;
const schemaSql = (): string => {
  if (!/^test_auth_[a-f0-9]{16}$/.test(schema)) throw new Error('El esquema temporal no es válido.');
  return `"${schema}"`;
};
let admin: DatabaseDataSource | undefined;
let isolated: DatabaseDataSource | undefined;
let created = false;
let step = 'conexión y migraciones';
/** Migración de S1 que añade `sesion_usuario.ultima_actividad` (nullable). */
const INACTIVITY_MIGRATION = 'SesionInactividad20261111110000';

async function sessionActivityColumn(): Promise<{ is_nullable: string; data_type: string } | undefined> {
  const rows = await isolated!.query(`SELECT is_nullable, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'sesion_usuario' AND column_name = 'ultima_actividad'`, [schema]) as Array<{ is_nullable: string; data_type: string }>;
  return rows[0];
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

  step = 'comprobación de nulabilidad';
  const nullable = await isolated.query(`SELECT is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'usuario' AND column_name = 'id_externo_sso'`, [schema]) as Array<{ is_nullable: string }>;
  if (nullable[0]?.is_nullable !== 'YES') throw new Error('id_externo_sso debe conservar el historial y admitir cuentas locales.');
  step = 'creación de cuenta de prueba';
  const id = '00000000-0000-4000-8000-000000000001';
  await isolated.query(`INSERT INTO ${schemaSql()}."usuario" ("id","email","nombres","apellidos","rol","estado","id_externo_sso") VALUES ($1,$2,$3,$4,$5,$6,NULL)`, [id, 'verificador@uleam.edu.ec', 'Verificador', 'Auth', 'ADMIN', 'ACTIVO']);
  step = 'comprobación de tablas';
  const tables = await isolated.query(`SELECT to_regclass($1) AS credenciales, to_regclass($2) AS sesiones, to_regclass($3) AS refresh, to_regclass($4) AS recovery, to_regclass($5) AS outbox, to_regclass($6) AS importaciones`, [ `${schema}.credencial_usuario`, `${schema}.sesion_usuario`, `${schema}.sesion_refresh_hash`, `${schema}.solicitud_recuperacion`, `${schema}.correo_salida`, `${schema}.preparacion_importacion` ]) as Array<Record<string, string | null>>;
  if (!tables[0]?.credenciales || !tables[0]?.sesiones || !tables[0]?.refresh || !tables[0]?.recovery || !tables[0]?.outbox || !tables[0]?.importaciones) throw new Error('Faltan tablas de autenticación u preparación de importación.');

  step = 'columna de inactividad de sesiones';
  const activityColumn = await sessionActivityColumn();
  if (!activityColumn) throw new Error(`Falta sesion_usuario.ultima_actividad (${INACTIVITY_MIGRATION}).`);
  if (activityColumn.is_nullable !== 'YES') throw new Error('sesion_usuario.ultima_actividad debe admitir NULL (sesión recién creada).');
  if (activityColumn.data_type !== 'timestamp with time zone') throw new Error(`sesion_usuario.ultima_actividad debe ser timestamptz, no ${activityColumn.data_type}.`);

  step = 'reversión hasta autenticación';
  // Se revierte por nombre y no por cantidad: cada migración posterior ejecuta su down() y la
  // comprobación sigue apuntando a la de autenticación aunque se agreguen migraciones nuevas.
  const executed = await isolated.query(`SELECT "name" FROM ${schemaSql()}."migrations" ORDER BY "timestamp" DESC, "id" DESC`) as Array<{ name: string }>;
  const authIndex = executed.findIndex((row) => row.name === AUTH_MIGRATION);
  if (authIndex < 0) throw new Error(`No se ejecutó la migración ${AUTH_MIGRATION}.`);
  const laterMigrations = executed.slice(0, authIndex);
  if (!laterMigrations.some((row) => row.name === INACTIVITY_MIGRATION)) throw new Error(`No se ejecutó la migración ${INACTIVITY_MIGRATION}.`);
  for (const later of laterMigrations) {
    step = `reversión de ${later.name}`;
    await isolated.undoLastMigration({ transaction: 'each' });
    if (later.name === INACTIVITY_MIGRATION && await sessionActivityColumn()) throw new Error('down() de la inactividad de sesiones no eliminó sesion_usuario.ultima_actividad.');
  }
  const last = await isolated.query(`SELECT "name" FROM ${schemaSql()}."migrations" ORDER BY "timestamp" DESC, "id" DESC LIMIT 1`) as Array<{ name: string }>;
  if (last[0]?.name !== AUTH_MIGRATION) throw new Error(`La última migración aplicada es ${last[0]?.name ?? 'ninguna'}, no ${AUTH_MIGRATION}.`);

  step = 'reversión protegida';
  let protectedRollback = false;
  try { await isolated.undoLastMigration(); } catch (error: unknown) {
    protectedRollback = error instanceof Error && error.message.includes('cuentas creadas sin identificador SSO');
  }
  if (!protectedRollback) throw new Error('La reversión de autenticación no protegió una cuenta nueva sin SSO.');
  const preserved = await isolated.query(`SELECT COUNT(*)::int AS total FROM ${schemaSql()}."usuario" WHERE "id" = $1 AND "id_externo_sso" IS NULL`, [id]) as Array<{ total: number }>;
  if (Number(preserved[0]?.total ?? 0) !== 1) throw new Error('La reversión alteró una cuenta histórica del esquema de prueba.');
  process.stdout.write('Migraciones de autenticación e importación verificadas en esquema aislado; ultima_actividad nullable y eliminada por su down(); reversión protegida sin pérdida de cuentas.\n');
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
