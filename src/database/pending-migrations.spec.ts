import { vi } from 'vitest';
import { checkPendingMigrations, PENDING_MIGRATIONS_MESSAGE } from './pending-migrations.js';

describe('checkPendingMigrations', () => {
  it('no hace nada si no hay migraciones pendientes', async () => {
    const logger = { error: vi.fn() };

    await checkPendingMigrations({ showMigrations: vi.fn().mockResolvedValue(false) }, 'production', logger);

    expect(logger.error).not.toHaveBeenCalled();
  });

  it('solo registra en desarrollo cuando hay migraciones pendientes', async () => {
    const logger = { error: vi.fn() };

    await expect(checkPendingMigrations({ showMigrations: vi.fn().mockResolvedValue(true) }, 'development', logger)).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(PENDING_MIGRATIONS_MESSAGE);
    expect(PENDING_MIGRATIONS_MESSAGE).toContain('npm run migration:run');
  });

  it('detiene el arranque en producción cuando hay migraciones pendientes', async () => {
    const logger = { error: vi.fn() };

    await expect(checkPendingMigrations({ showMigrations: vi.fn().mockResolvedValue(true) }, 'production', logger)).rejects.toThrow('migraciones pendientes');
    expect(logger.error).toHaveBeenCalled();
  });

  it('no consulta la base de datos en el entorno de pruebas', async () => {
    const showMigrations = vi.fn();

    await checkPendingMigrations({ showMigrations }, 'test', { error: vi.fn() });

    expect(showMigrations).not.toHaveBeenCalled();
  });
});
