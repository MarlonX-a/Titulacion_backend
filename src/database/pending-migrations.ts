import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { NodeEnvironment } from '../config/environment.js';

export const PENDING_MIGRATIONS_MESSAGE =
  'Hay migraciones pendientes en la base de datos. Revísalas con `npm run migration:show` y aplícalas con `npm run migration:run` antes de usar la API.';

/**
 * Comprueba al arrancar si quedan migraciones sin aplicar. Una migración
 * pendiente provoca errores de columna inexistente que la API devuelve como 503.
 * En producción detiene el arranque; en cualquier otro entorno solo lo registra.
 * `main.ts` se niega a arrancar con `NODE_ENV=test`, por lo que no hay caso de pruebas.
 */
export async function checkPendingMigrations(
  dataSource: Pick<DataSource, 'showMigrations'>,
  nodeEnv: NodeEnvironment,
  logger: Pick<Logger, 'error'> = new Logger('Migraciones'),
): Promise<void> {
  if (!(await dataSource.showMigrations())) return;
  logger.error(PENDING_MIGRATIONS_MESSAGE);
  if (nodeEnv === 'production') throw new Error(PENDING_MIGRATIONS_MESSAGE);
}
