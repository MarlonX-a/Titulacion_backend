import { loadEnvironment } from '../src/config/load-environment.js';
import { validateEnvironment } from '../src/config/environment.js';

describe('Configuración backend', () => {
  const database = { DB_USERNAME: 'test_user', DB_PASSWORD: 'test_password', DB_NAME: 'test_database' };

  it('usa valores por defecto seguros y carga la nueva configuración de ejemplo', () => {
    expect(validateEnvironment(database)).toMatchObject({ NODE_ENV: 'development', PORT: 3000, DB_SCHEMA: 'titulacion_dev', SWAGGER_ENABLED: true });
    expect(loadEnvironment('.env.example', {})).toMatchObject({ DB_SCHEMA: 'titulacion_dev', REDIS_HOST: '127.0.0.1', SMTP_PORT: 1025, S3_BUCKET: 'titulacion-archivos' });
  });

  it('mantiene prioridad del entorno sobre el archivo y conserva secretos exactos', () => {
    expect(loadEnvironment('.env.example', { ...database, DB_PASSWORD: ' secret ', PORT: '3333' })).toMatchObject({ DB_PASSWORD: ' secret ', PORT: 3333 });
  });

  it('rechaza configuración de puerto insegura sin mostrar credenciales', () => {
    expect(() => validateEnvironment({ ...database, DB_PORT: 'dato-privado' })).toThrow('DB_PORT');
    expect(() => loadEnvironment('.env.example', { ...database, DB_PASSWORD: 'no-revelar', PORT: '0xBB8' })).toThrow('PORT');
  });
});
