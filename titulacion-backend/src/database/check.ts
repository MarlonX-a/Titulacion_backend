import 'reflect-metadata';
import { loadEnvironment } from '../config/load-environment.js';
import {
  DATABASE_CONNECTION_ERROR,
  DatabaseDataSource,
} from './database-data-source.js';
import { createDatabaseOptions } from './database.options.js';

async function checkDatabase(): Promise<void> {
  let dataSource: DatabaseDataSource | undefined;

  try {
    const environment = loadEnvironment();
    dataSource = new DatabaseDataSource(createDatabaseOptions(environment));
    await dataSource.initialize();
    await dataSource.query('SELECT 1');
    console.log('Conexión a PostgreSQL verificada correctamente (SELECT 1).');
  } catch (error: unknown) {
    // La validación propia solo informa nombres de variables, nunca sus valores.
    const message =
      error instanceof Error &&
      error.message.startsWith('Configuración inválida:')
        ? error.message
        : DATABASE_CONNECTION_ERROR;
    console.error(message);
    process.exitCode = 1;
  } finally {
    if (dataSource?.isInitialized) {
      try {
        await dataSource.destroy();
      } catch {
        console.error('No se pudo cerrar la conexión a PostgreSQL.');
        process.exitCode = 1;
      }
    }
  }
}

await checkDatabase();
