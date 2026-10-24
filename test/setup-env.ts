// Cada worker de pruebas usa datos ficticios, independientemente del .env local.
Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: '3000',
  SWAGGER_ENABLED: 'true',
  DB_HOST: '127.0.0.1',
  DB_PORT: '1',
  DB_SCHEMA: 'public',
  DB_USERNAME: 'test_user',
  DB_PASSWORD: 'test_password',
  DB_NAME: 'test_database',
});
