import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Claves JWT desechables para las pruebas que montan el AuthenticationService real: el servicio
 * siempre exige rutas de claves configuradas y no genera claves efímeras por sí mismo.
 */
type JwtKeyPaths = { JWT_PRIVATE_KEY_PATH: string; JWT_PUBLIC_KEY_PATH: string };

function throwawayJwtKeys(): JwtKeyPaths {
  // Un par por proceso de pruebas, aunque este archivo se ejecute antes de cada archivo de prueba.
  const shared = globalThis as typeof globalThis & { titulacionJwtKeys?: JwtKeyPaths };
  if (shared.titulacionJwtKeys) return shared.titulacionJwtKeys;
  const directory = mkdtempSync(join(tmpdir(), 'titulacion-e2e-keys-'));
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const privateKey = join(directory, 'jwt-private.pem');
  const publicKey = join(directory, 'jwt-public.pem');
  writeFileSync(privateKey, pair.privateKey, { mode: 0o600 });
  writeFileSync(publicKey, pair.publicKey, { mode: 0o644 });
  process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
  shared.titulacionJwtKeys = { JWT_PRIVATE_KEY_PATH: privateKey, JWT_PUBLIC_KEY_PATH: publicKey };
  return shared.titulacionJwtKeys;
}

// Cada worker de pruebas usa datos ficticios, independientemente del .env local.
Object.assign(process.env, {
  NODE_ENV: 'test',
  // La aplicación no ramifica por NODE_ENV: las pruebas desactivan de forma explícita la lectura de
  // .env y las tareas periódicas en segundo plano.
  IGNORE_ENV_FILE: 'true',
  BACKGROUND_TASKS_ENABLED: 'false',
  PORT: '3000',
  SWAGGER_ENABLED: 'true',
  DB_HOST: '127.0.0.1',
  DB_PORT: '1',
  DB_SCHEMA: 'public',
  DB_USERNAME: 'test_user',
  DB_PASSWORD: 'test_password',
  DB_NAME: 'test_database',
  ...throwawayJwtKeys(),
});
