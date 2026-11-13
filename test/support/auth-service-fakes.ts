import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import { vi } from 'vitest';
import type { AuditoriaService } from '../../src/auditoria/auditoria.service.js';
import type { AuthRateLimiterService } from '../../src/auth/auth-rate-limiter.service.js';
import { AuthenticationService } from '../../src/auth/authentication.service.js';
import type { PrimerAccesoService } from '../../src/auth/primer-acceso.service.js';
import type { AppEnvironment } from '../../src/config/environment.js';

/** Repositorio TypeORM simulado: cada método es un `vi.fn()` reemplazable por prueba. */
export function fakeRepository(overrides: Record<string, unknown> = {}) {
  return {
    findOneBy: vi.fn().mockResolvedValue(null),
    findOne: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({ affected: 1 }),
    save: vi.fn((value: unknown) => Promise.resolve(value)),
    insert: vi.fn().mockResolvedValue(undefined),
    create: vi.fn((value: Record<string, unknown>) => ({ ...value })),
    ...overrides,
  };
}

export type FakeRepository = ReturnType<typeof fakeRepository>;

/** DataSource simulado: la transacción ejecuta el callback con un manager que comparte los repositorios. */
export function fakeDataSource(repositories: Array<[unknown, FakeRepository]> = []) {
  const map = new Map<unknown, FakeRepository>(repositories);
  const repo = (entity: unknown): FakeRepository => {
    let found = map.get(entity);
    if (!found) { found = fakeRepository(); map.set(entity, found); }
    return found;
  };
  const getRepository = vi.fn(repo);
  const manager = { getRepository };
  const dataSource = { getRepository, manager, transaction: vi.fn((work: (value: typeof manager) => Promise<unknown>) => work(manager)) };
  return { dataSource: dataSource as unknown as DataSource, getRepository, repo, transaction: dataSource.transaction };
}

export function limiterMock() {
  return {
    enforce: vi.fn().mockResolvedValue(undefined),
    assertBelow: vi.fn().mockResolvedValue(undefined),
    reserve: vi.fn().mockResolvedValue(true),
    release: vi.fn().mockResolvedValue(undefined),
    hit: vi.fn().mockResolvedValue(1),
    reset: vi.fn().mockResolvedValue(undefined),
    remember: vi.fn().mockResolvedValue(undefined),
    rememberOnce: vi.fn().mockResolvedValue(true),
    recall: vi.fn().mockResolvedValue(null),
  };
}

export function auditoriaMock() {
  return { registrarEventoSeguridad: vi.fn().mockResolvedValue(undefined) };
}

/** Avisos del primer acceso simulados: no hacen nada y nunca fallan. */
export function primerAccesoMock() {
  return { avisarAlTitular: vi.fn().mockResolvedValue(undefined), vigilarActivacionesPorIp: vi.fn().mockResolvedValue(undefined) };
}

/** Par de claves RS256 y llave del outbox desechables en un directorio temporal. */
export function throwawayKeyPaths() {
  const directory = mkdtempSync(join(tmpdir(), 'titulacion-auth-spec-'));
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const privateKey = join(directory, 'jwt-private.pem');
  const publicKey = join(directory, 'jwt-public.pem');
  writeFileSync(privateKey, pair.privateKey);
  writeFileSync(publicKey, pair.publicKey);
  const outboxKey = join(directory, 'outbox.key');
  writeFileSync(outboxKey, randomBytes(32));
  return { privateKey, publicKey, outboxKey, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

export async function authenticationServiceWith(
  keys: { privateKey: string; publicKey: string; outboxKey: string },
  dataSource: DataSource,
  limiter: ReturnType<typeof limiterMock>,
  auditoria: ReturnType<typeof auditoriaMock>,
  primerAcceso: ReturnType<typeof primerAccesoMock> = primerAccesoMock(),
): Promise<AuthenticationService> {
  const config = new ConfigService<AppEnvironment, true>({
    NODE_ENV: 'development', AUTH_ISSUER: 'http://127.0.0.1:3000', JWT_PRIVATE_KEY_PATH: keys.privateKey, JWT_PUBLIC_KEY_PATH: keys.publicKey,
    OUTBOX_ENCRYPTION_KEY_PATH: keys.outboxKey,
  } as AppEnvironment);
  const service = new AuthenticationService(config, dataSource, limiter as unknown as AuthRateLimiterService, auditoria as unknown as AuditoriaService, primerAcceso as unknown as PrimerAccesoService);
  await service.onModuleInit();
  return service;
}
