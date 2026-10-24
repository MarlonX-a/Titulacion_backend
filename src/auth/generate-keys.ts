import { mkdirSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const directory = '.secrets';
mkdirSync(directory, { recursive: true, mode: 0o700 });
const paths = {
  privateKey: `${directory}/jwt-private.pem`,
  publicKey: `${directory}/jwt-public.pem`,
  outboxKey: `${directory}/outbox.key`,
};
try {
  const pair = generateKeyPairSync('rsa', { modulusLength: 3072, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  writeFileSync(paths.privateKey, pair.privateKey, { flag: 'wx', mode: 0o600 });
  writeFileSync(paths.publicKey, pair.publicKey, { flag: 'wx', mode: 0o644 });
  writeFileSync(paths.outboxKey, randomBytes(32), { flag: 'wx', mode: 0o600 });
  process.stdout.write('Claves creadas en .secrets. Añade JWT_PRIVATE_KEY_PATH=.secrets/jwt-private.pem, JWT_PUBLIC_KEY_PATH=.secrets/jwt-public.pem y OUTBOX_ENCRYPTION_KEY_PATH=.secrets/outbox.key al .env.\n');
} catch {
  process.stderr.write('No se generaron las claves. Comprueba si ya existen archivos en .secrets; no se sobrescribieron.\n');
  process.exitCode = 1;
}
