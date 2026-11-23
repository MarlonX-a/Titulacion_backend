import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CorreoSalida } from './entities/correo-salida.entity.js';
import { CredencialUsuario } from './entities/credencial-usuario.entity.js';
import { ClaveTemporalVisible } from './entities/clave-temporal-visible.entity.js';
import { hashPassword } from './password-hasher.js';
import type { EntityManager } from 'typeorm';

export const TEMP_PASSWORD_TTL_MS = 72 * 60 * 60 * 1000;

/** Vigencia predeterminada, en horas, de claves temporales de estudiantes importados. */
export const IMPORT_TEMP_TTL_HOURS_DEFAULT = 24;

/** Vigencia en milisegundos de la clave temporal de importación; un valor ausente o inválido usa el predeterminado. */
export function importTempTtlMs(hours: unknown): number {
  const valid = typeof hours === 'number' && Number.isInteger(hours) && hours >= 1 && hours <= 168;
  return (valid ? hours : IMPORT_TEMP_TTL_HOURS_DEFAULT) * 60 * 60 * 1000;
}

export function readEncryptionKey(path: string): string {
  const key = readFileSync(path);
  if (key.length !== 32) throw new Error('La clave de cifrado debe tener 32 bytes.');
  return key.toString('base64');
}

export function tokenDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function generateOneTimeSecret(): string {
  return randomBytes(32).toString('base64url');
}

export async function setTemporaryPassword(
  manager: EntityManager,
  userId: string,
  password: string,
  outboxEncryptionKey: string,
  temporaryEncryptionKey: string,
  ttlMs = TEMP_PASSWORD_TTL_MS,
): Promise<CorreoSalida> {
  const credentials = manager.getRepository(CredencialUsuario);
  const current = await credentials.findOne({ where: { usuario_id: userId }, lock: { mode: 'pessimistic_write' } });
  const expiry = new Date(Date.now() + ttlMs);
  await persistTemporaryPassword(manager, userId, password, await hashPassword(password), expiry, temporaryEncryptionKey, current);
  return createEncryptedOutbox(manager, userId, 'ACCESO', password, expiry, outboxEncryptionKey);
}

/** Persiste hash y copia cifrada; `preparedHash` evita ejecutar Argon2 dentro de una importación larga. */
export async function persistTemporaryPassword(
  manager: EntityManager,
  userId: string,
  password: string,
  preparedHash: string,
  expiry: Date,
  encryptionKey: string,
  previous?: CredencialUsuario | null,
): Promise<void> {
  const credentials = manager.getRepository(CredencialUsuario);
  const current = previous === undefined
    ? await credentials.findOne({ where: { usuario_id: userId }, lock: { mode: 'pessimistic_write' } })
    : previous;
  const now = new Date();
  await credentials.save(credentials.create({
    usuario_id: userId,
    password_hash: preparedHash,
    requiere_cambio: true,
    temporal_expira_en: expiry,
    version_sesion: current ? current.version_sesion + 1 : 0,
    actualizada_en: now,
  }));
  const repo = manager.getRepository(ClaveTemporalVisible);
  await repo.save(encryptTemporarySecret(repo.create({ usuario_id: userId }), password, expiry, encryptionKey, now));
}

export function decryptTemporarySecret(record: ClaveTemporalVisible, encryptionKey: string): string {
  const key = Buffer.from(encryptionKey, 'base64');
  if (key.length !== 32) throw new Error('La clave de cifrado no es válida.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.nonce, 'hex'));
  decipher.setAuthTag(Buffer.from(record.tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(record.secreto_cifrado, 'base64')), decipher.final()]).toString('utf8');
}

function encryptTemporarySecret(
  record: ClaveTemporalVisible,
  password: string,
  expiry: Date,
  encryptionKey: string,
  now: Date,
): ClaveTemporalVisible {
  const key = Buffer.from(encryptionKey, 'base64');
  if (key.length !== 32) throw new Error('Falta la clave externa para proteger la clave temporal.');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return Object.assign(record, {
    secreto_cifrado: encrypted.toString('base64'),
    nonce: nonce.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    expira_en: expiry,
    actualizada_en: now,
  });
}

export async function createTemporaryCredentialHash(password: string): Promise<string> {
  return hashPassword(password);
}

export function createEncryptedOutbox(
  manager: EntityManager,
  userId: string,
  type: 'ACCESO' | 'RECUPERACION',
  secret: string,
  expiry: Date,
  encryptionKey: string,
): CorreoSalida {
  if (Buffer.from(encryptionKey, 'base64').length !== 32) {
    throw new Error('Falta la clave externa para proteger el correo pendiente.');
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'base64'), nonce);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return manager.getRepository(CorreoSalida).create({
    usuario_id: userId,
    tipo: type,
    secreto_cifrado: encrypted.toString('base64'),
    nonce: nonce.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    expira_en: expiry,
    enviado_en: null,
    intentos: 0,
  });
}
