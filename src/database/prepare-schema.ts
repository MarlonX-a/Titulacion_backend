import { Client } from 'pg';
import { loadEnvironment } from '../config/load-environment.js';

const environment = loadEnvironment();
if (environment.DB_SCHEMA !== 'titulacion_dev') {
  throw new Error('Este comando solo prepara el esquema limpio titulacion_dev; DB_SCHEMA no coincide.');
}
const client = new Client({
  host: environment.DB_HOST, port: environment.DB_PORT,
  user: environment.DB_USERNAME, password: environment.DB_PASSWORD,
  database: environment.DB_NAME, connectionTimeoutMillis: 5000,
});
try {
  await client.connect();
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${environment.DB_SCHEMA}" AUTHORIZATION CURRENT_USER`);
  process.stdout.write('Esquema titulacion_dev listo; no se modificó public ni local_demo.\n');
} finally {
  await client.end().catch(() => undefined);
}
