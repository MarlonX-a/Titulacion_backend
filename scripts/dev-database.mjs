// Shared helpers for development-only database scripts: reads .env (process.env wins) and opens a
// pg client guarded to a local database and the titulacion_dev schema.
import { readFileSync } from 'node:fs';
import pg from 'pg';

export const DEV_SCHEMA = 'titulacion_dev';

function readEnv() {
  const file = new URL('../.env', import.meta.url);
  const entries = readFileSync(file, 'utf8').split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]);
  return { ...Object.fromEntries(entries), ...process.env };
}

/** Connects to the local development database; `operation` names the script in guard errors (e.g. "seed"). */
export async function connectDevDatabase(operation) {
  const env = readEnv();
  if (env.DB_SCHEMA !== DEV_SCHEMA) throw new Error(`The ${operation} only runs against the ${DEV_SCHEMA} schema.`);
  if (!['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST)) throw new Error(`The ${operation} only runs against a local database.`);
  const client = new pg.Client({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USERNAME, password: env.DB_PASSWORD, database: env.DB_NAME });
  await client.connect();
  return client;
}
