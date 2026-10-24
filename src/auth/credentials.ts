import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { argon2id, hash } from 'argon2';
import { CorreoSalida } from './entities/correo-salida.entity.js';
import { CredencialUsuario } from './entities/credencial-usuario.entity.js';
import type { EntityManager } from 'typeorm';

export const TEMP_PASSWORD_TTL_MS = 72 * 60 * 60 * 1000;

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
  encryptionKey: string,
): Promise<CorreoSalida> {
  const credentials = manager.getRepository(CredencialUsuario);
  const expiry = new Date(Date.now() + TEMP_PASSWORD_TTL_MS);
  await credentials.save(credentials.create({
    usuario_id: userId,
    password_hash: await hash(password, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }),
    requiere_cambio: true,
    temporal_expira_en: expiry,
    version_sesion: 0,
    actualizada_en: new Date(),
  }));
  return createEncryptedOutbox(manager, userId, 'ACCESO', password, expiry, encryptionKey);
}

export async function createTemporaryCredentialHash(password: string): Promise<string> {
  return hash(password, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
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
