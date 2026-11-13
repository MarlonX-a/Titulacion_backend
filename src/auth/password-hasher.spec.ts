import { argon2i, argon2id, hash } from 'argon2';
import { DUMMY_HASH, hashPassword, needsRehash, verifyPassword } from './password-hasher.js';

describe('password-hasher', () => {
  it('genera hashes Argon2id vigentes que se verifican', async () => {
    const digest = await hashPassword('Marea-Volcan-Zafiro-41');

    expect(digest.startsWith('$argon2id$')).toBe(true);
    expect(needsRehash(digest)).toBe(false);
    await expect(verifyPassword(digest, 'Marea-Volcan-Zafiro-41')).resolves.toBe(true);
    await expect(verifyPassword(digest, 'otra-clave-larga-12')).resolves.toBe(false);
  });

  it('pide regenerar hashes con otros parámetros, otro tipo o malformados', async () => {
    expect(needsRehash(await hash('x', { type: argon2id, memoryCost: 4096, timeCost: 3, parallelism: 1 }))).toBe(true);
    expect(needsRehash(await hash('x', { type: argon2i, memoryCost: 19456, timeCost: 2, parallelism: 1 }))).toBe(true);
    expect(needsRehash('no-es-un-hash')).toBe(true);
    expect(needsRehash('$argon2id$basura')).toBe(true);
  });

  it('el hash ficticio usa los parámetros vigentes y nunca coincide', async () => {
    expect(needsRehash(DUMMY_HASH)).toBe(false);
    await expect(verifyPassword(DUMMY_HASH, 'cualquier-clave')).resolves.toBe(false);
  });

  it('verifyPassword devuelve false ante un hash malformado en lugar de lanzar', async () => {
    await expect(verifyPassword('basura', 'cualquier-clave')).resolves.toBe(false);
  });
});
