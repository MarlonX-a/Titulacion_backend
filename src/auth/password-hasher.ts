import { argon2id, hash, needsRehash as argon2NeedsRehash, verify } from 'argon2';

/**
 * Parámetros Argon2id vigentes (OWASP: m=19 MiB, t=2, p=1). Cambiarlos hace que los hashes
 * existentes se regeneren en el siguiente inicio de sesión correcto (`needsRehash`).
 *
 * No hay semáforo de concurrencia: argon2 se ejecuta en el pool de hilos de libuv (4 hilos por
 * defecto), que ya limita cuántos hashes ocupan memoria a la vez.
 */
export const ARGON2_PARAMETROS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

/**
 * Hash con los parámetros vigentes de una contraseña que nadie conoce. Se verifica cuando el
 * correo no existe para que la respuesta tarde lo mismo que con una cuenta real.
 */
export const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQxMjM0NTY3OA$8P/AGk8BGbfQwIMiWMLOOW0ebK6nPzO6kXGiVDluoYY';

export function hashPassword(password: string): Promise<string> {
  return hash(password, { type: argon2id, ...ARGON2_PARAMETROS });
}

/** `false` también si el hash está malformado: nunca lanza por datos guardados. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password).catch(() => false);
}

/** Indica si el hash no es Argon2id con los parámetros vigentes. */
export function needsRehash(passwordHash: string): boolean {
  if (!passwordHash.startsWith('$argon2id$')) return true;
  try {
    return argon2NeedsRehash(passwordHash, ARGON2_PARAMETROS);
  } catch {
    return true;
  }
}
