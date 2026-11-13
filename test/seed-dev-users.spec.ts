import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARGON2_PARAMETROS } from '../src/auth/password-hasher.js';

/**
 * `scripts/seed-dev-users.mjs` se ejecuta con `node` sin compilar (no depende de `dist/`), así que
 * no puede importar `src/auth/password-hasher.ts`. Repite los parámetros de Argon2id y esta prueba
 * falla si se separan de la fuente única de verdad. Se lee el código: importarlo ejecutaría la siembra.
 */
const script = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/seed-dev-users.mjs'), 'utf8');

describe('scripts/seed-dev-users.mjs', () => {
  it('usa los mismos parámetros de Argon2id que PasswordHasher', () => {
    const declaracion = /const ARGON2_PARAMETROS = \{([^}]*)\};/.exec(script);
    expect(declaracion, 'el script debe declarar ARGON2_PARAMETROS').not.toBeNull();
    const parametros = Object.fromEntries([...declaracion![1]!.matchAll(/(\w+)\s*:\s*(\d+)/g)].map(([, clave, valor]) => [clave, Number(valor)]));
    expect(parametros).toEqual({ ...ARGON2_PARAMETROS });
  });

  it('todo hash del script usa ARGON2_PARAMETROS y Argon2id, sin parámetros escritos en la llamada', () => {
    const llamadas = [...script.matchAll(/\bhash\(([^)]*)\)/g)].map(([, argumentos]) => argumentos!);
    expect(llamadas.length).toBeGreaterThan(0);
    for (const argumentos of llamadas) {
      expect(argumentos).toContain('type: argon2id');
      expect(argumentos).toContain('...ARGON2_PARAMETROS');
      expect(argumentos).not.toMatch(/memoryCost|timeCost|parallelism/);
    }
  });
});
