import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readEncryptionKey } from './credentials.js';

describe('readEncryptionKey', () => {
  let directory: string;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'encryption-key-')); });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('lee claves binarias existentes de 32 bytes', () => {
    const key = randomBytes(32);
    const path = join(directory, 'binary.key');
    writeFileSync(path, key);
    expect(Buffer.from(readEncryptionKey(path), 'base64')).toEqual(key);
  });

  it('decodifica una clave hexadecimal de texto de 64 caracteres', () => {
    const key = randomBytes(32);
    const path = join(directory, 'hex.key');
    writeFileSync(path, `${key.toString('hex')}\n`, 'utf8');
    expect(Buffer.from(readEncryptionKey(path), 'base64')).toEqual(key);
  });

  it('rechaza contenido de otra longitud o formato', () => {
    const path = join(directory, 'invalid.key');
    writeFileSync(path, 'not-a-key', 'utf8');
    expect(() => readEncryptionKey(path)).toThrow('32 bytes binarios');
  });
});
