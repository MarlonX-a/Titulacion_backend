import { fileURLToPath } from 'node:url';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import type { AppEnvironment } from '../config/environment.js';

export type DatabaseEnvironment = Pick<
  AppEnvironment,
  | 'DB_HOST'
  | 'DB_PORT'
  | 'DB_USERNAME'
  | 'DB_PASSWORD'
  | 'DB_NAME'
  | 'DB_SCHEMA'
> &
  Partial<Pick<AppEnvironment, 'DB_SSL' | 'DB_SSL_REJECT_UNAUTHORIZED'>>;

/** TLS hacia PostgreSQL: desactivado salvo DB_SSL; verifica el certificado salvo que se desactive explícitamente. */
export function databaseSslOptions(
  environment: Pick<DatabaseEnvironment, 'DB_SSL' | 'DB_SSL_REJECT_UNAUTHORIZED'>,
): Pick<PostgresConnectionOptions, 'ssl'> {
  if (environment.DB_SSL !== true) return {};
  return { ssl: { rejectUnauthorized: environment.DB_SSL_REJECT_UNAUTHORIZED !== false } };
}

export function createDatabaseOptions(
  environment: DatabaseEnvironment,
): PostgresConnectionOptions {
  return {
    type: 'postgres',
    host: environment.DB_HOST,
    port: environment.DB_PORT,
    username: environment.DB_USERNAME,
    password: environment.DB_PASSWORD,
    database: environment.DB_NAME,
    schema: environment.DB_SCHEMA,
    ...databaseSslOptions(environment),
    applicationName: 'titulacion-backend',
    connectTimeoutMS: 5000,
    synchronize: false,
    dropSchema: false,
    migrationsRun: false,
    installExtensions: false,
    logging: false,
    // Nest y el CLI ejecutan el código compilado; nunca se mezclan .ts y .js.
    entities: [
      fileURLToPath(new URL('../**/*.entity.js', import.meta.url)).replaceAll(
        '\\',
        '/',
      ),
    ],
    migrations: [
      fileURLToPath(new URL('./migrations/*.js', import.meta.url)).replaceAll(
        '\\',
        '/',
      ),
    ],
  };
}
