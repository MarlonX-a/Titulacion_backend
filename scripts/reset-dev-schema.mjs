// Drops the local titulacion_dev schema so migrations can recreate it. Never touches public or local_demo.
import { readFileSync } from 'node:fs';
import pg from 'pg';

function readEnv() {
  const file = new URL('../.env', import.meta.url);
  const entries = readFileSync(file, 'utf8').split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]);
  return { ...Object.fromEntries(entries), ...process.env };
}

const env = readEnv();
if (env.DB_SCHEMA !== 'titulacion_dev') throw new Error('The reset only runs against the titulacion_dev schema.');
if (!['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST)) throw new Error('The reset only runs against a local database.');

const client = new pg.Client({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USERNAME, password: env.DB_PASSWORD, database: env.DB_NAME });
await client.connect();
try {
  await client.query('DROP SCHEMA IF EXISTS "titulacion_dev" CASCADE');
  console.log('Schema titulacion_dev dropped. Run npm run db:prepare-auth, npm run usuario:bootstrap-admin (optional) and npm run db:seed-dev-users.');
} finally {
  await client.end();
}
