import { loadEnvironment } from './load-environment.js';

describe('Configuración del CLI', () => {
  it('lee .env.example sin depender de credenciales locales', () => {
    expect(loadEnvironment('.env.example', {})).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      DB_HOST: 'localhost',
      DB_PORT: 5432,
      DB_PASSWORD: 'CAMBIAR_PASSWORD',
    });
  });

  it('prioriza el entorno y no lo modifica', () => {
    const environment = {
      DB_PORT: '5433',
      DB_PASSWORD: 'password-del-entorno',
      SWAGGER_ENABLED: 'false',
    };
    const snapshot = { ...environment };

    expect(loadEnvironment('.env.example', environment)).toMatchObject({
      DB_PORT: 5433,
      DB_PASSWORD: 'password-del-entorno',
      SWAGGER_ENABLED: false,
    });
    expect(environment).toEqual(snapshot);
  });

  it('permite usar solo el entorno cuando no hay archivo', () => {
    expect(
      loadEnvironment('test/no-existe.env', {
        DB_USERNAME: 'test_user',
        DB_PASSWORD: 'test_password',
        DB_NAME: 'test_database',
      }),
    ).toMatchObject({ DB_HOST: 'localhost', DB_PORT: 5432 });
  });

  it('rechaza configuración inválida sin revelar su valor', () => {
    expect(() =>
      loadEnvironment('.env.example', { DB_PORT: 'dato-privado' }),
    ).toThrow(
      'Configuración inválida: DB_PORT debe ser un entero entre 1 y 65535.',
    );
  });
});
