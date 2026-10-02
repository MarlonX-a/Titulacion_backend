import { fileURLToPath } from 'node:url';
import { DatabaseDataSource } from '../../database/database-data-source.js';
import { createDatabaseOptions } from '../../database/database.options.js';
import { loadEnvironment } from '../../config/load-environment.js';
import { provisionLocalDemoAccounts } from './provision-local-demo-accounts.js';

async function setup(): Promise<void> {
  const environment = loadEnvironment();
  if (environment.AUTH_MODE !== 'local') {
    throw new Error('Configura AUTH_MODE=local antes de preparar las cuentas.');
  }

  const baseOptions = createDatabaseOptions(environment);
  const schemaCreator = new DatabaseDataSource({
    ...baseOptions,
    schema: 'public',
    entities: [],
    migrations: [],
  });
  let localDataSource: DatabaseDataSource | undefined;

  try {
    await schemaCreator.initialize();
    await schemaCreator.query('CREATE SCHEMA IF NOT EXISTS "local_demo"');

    localDataSource = new DatabaseDataSource({
      ...baseOptions,
      entities: [
        fileURLToPath(new URL('../../**/*.entity.js', import.meta.url)).replaceAll(
          '\\',
          '/',
        ),
      ],
      migrations: [
        fileURLToPath(
          new URL('../../database/migrations/*.js', import.meta.url),
        ).replaceAll('\\', '/'),
      ],
    });
    await localDataSource.initialize();
    await localDataSource.runMigrations({ transaction: 'all' });
    await provisionLocalDemoAccounts(localDataSource);
  } finally {
    if (localDataSource?.isInitialized) await localDataSource.destroy();
    if (schemaCreator.isInitialized) await schemaCreator.destroy();
  }
}

try {
  await setup();
  console.info(
    'Esquema local_demo preparado con las cuentas de prueba. No se modificó public.',
  );
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : 'Error de preparación.';
  console.error(message);
  process.exitCode = 1;
}
