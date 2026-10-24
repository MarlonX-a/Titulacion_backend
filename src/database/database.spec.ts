import { DataSource } from 'typeorm';
import {
  DatabaseDataSource,
  DATABASE_CONNECTION_ERROR,
} from './database-data-source.js';
import { createDatabaseOptions } from './database.options.js';

const options = createDatabaseOptions({
  DB_HOST: 'localhost',
  DB_PORT: 5432,
  DB_SCHEMA: 'public',
  DB_USERNAME: 'test_user',
  DB_PASSWORD: 'test_password',
  DB_NAME: 'test_database',
});

describe('Configuración de PostgreSQL', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('no modifica el esquema automáticamente ni instala extensiones', () => {
    expect(options).toMatchObject({
      synchronize: false,
      dropSchema: false,
      migrationsRun: false,
      installExtensions: false,
      connectTimeoutMS: 5000,
    });
  });

  it('usa el esquema definido por configuración', () => {
    expect(options.schema).toBe('public');
    expect(
      createDatabaseOptions({
        DB_HOST: 'localhost',
        DB_PORT: 5432,
        DB_SCHEMA: 'local_demo',
        DB_USERNAME: 'test_user',
        DB_PASSWORD: 'test_password',
        DB_NAME: 'test_database',
      }).schema,
    ).toBe('local_demo');
  });

  it('busca únicamente entidades y migraciones compiladas, con rutas válidas en Windows', () => {
    expect(options.entities).toEqual([
      expect.stringMatching(/\/\*\*\/\*\.entity\.js$/),
    ]);
    expect(options.migrations).toEqual([
      expect.stringMatching(/\/migrations\/\*\.js$/),
    ]);
    expect(
      JSON.stringify([options.entities, options.migrations]),
    ).not.toContain('\\');
  });

  it('sustituye errores del driver por un mensaje sin credenciales ni causa privada', async () => {
    vi.spyOn(DataSource.prototype, 'initialize').mockRejectedValueOnce(
      new Error('usuario-privado:password-privado@host-privado'),
    );
    const dataSource = new DatabaseDataSource(options);

    await expect(dataSource.initialize()).rejects.toThrow(
      DATABASE_CONNECTION_ERROR,
    );
  });
});
