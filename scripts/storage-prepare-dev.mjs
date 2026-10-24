import { mkdir, open } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, '.secrets', 'seaweedfs.env');
await mkdir(dirname(target), { recursive: true });
const contents = `WEED_S3_SSE_KEK=${randomBytes(32).toString('hex')}\n`;
try {
  const file = await open(target, 'wx', 0o600);
  try { await file.writeFile(contents, 'utf8'); }
  finally { await file.close(); }
  process.stdout.write('Clave de cifrado SeaweedFS creada en .secrets/seaweedfs.env. No la compartas ni la subas a Git.\n');
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
    process.stdout.write('La clave SeaweedFS ya existe; se conservó sin cambios.\n');
  } else {
    process.stderr.write('No se pudo preparar la clave privada de SeaweedFS.\n');
    process.exitCode = 1;
  }
}
