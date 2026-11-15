import { getQueueToken } from '@nestjs/bullmq';
import { Module, type ModuleMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { vi } from 'vitest';
import { ArchivoLimpiezaWorker } from '../../src/almacenamiento/archivo-limpieza.worker.js';
import { AuthRateLimiterService } from '../../src/auth/auth-rate-limiter.service.js';
import type { AppEnvironment } from '../../src/config/environment.js';
import { CorreoModule } from '../../src/correo/correo.module.js';
import { ExportacionesWorker } from '../../src/exportaciones/exportaciones.worker.js';
import { ImportacionesModule } from '../../src/importaciones/importaciones.module.js';
import { COLA_TRANSICIONES_PERIODO } from '../../src/periodos/transiciones-periodo.service.js';
import { TransicionesPeriodoWorker } from '../../src/periodos/transiciones-periodo.worker.js';

/** Configuración mínima de la aplicación para pruebas e2e sin servicios externos. */
export function testConfigService(): ConfigService<AppEnvironment, true> {
  return new ConfigService<AppEnvironment, true>({
    NODE_ENV: 'test', PORT: 3000, SWAGGER_ENABLED: true, DB_HOST: '127.0.0.1', DB_PORT: 5432,
    DB_SCHEMA: 'test', DB_USERNAME: 'test_user', DB_PASSWORD: 'test_password', DB_NAME: 'test_database',
    AUTH_ISSUER: 'http://127.0.0.1:3000', AUTH_ORIGINS: [], REDIS_PORT: 6379, SMTP_PORT: 1025, S3_REGION: 'us-east-1',
    BACKGROUND_TASKS_ENABLED: false, IGNORE_ENV_FILE: true,
  });
}

/** Sustituto de AuthenticationService: el token es la clave del mapa y resuelve al usuario asociado. */
export function tokenAuthenticationMock(tokens: Map<string, string>) {
  return { verifyToken: vi.fn((token: string) => Promise.resolve({ subject: tokens.get(token) ?? '', issuer: 'http://127.0.0.1:3000', firstAccess: false })) };
}

/** Limitador que nunca rechaza: las pruebas e2e no usan Redis. */
export const limitadorSinRedis: Pick<AuthRateLimiterService, 'enforce' | 'reserve' | 'release' | 'assertBelow' | 'hit' | 'reset' | 'remember' | 'rememberOnce' | 'recall' | 'onModuleDestroy'> = {
  enforce: () => Promise.resolve(),
  reserve: () => Promise.resolve(true),
  release: () => Promise.resolve(),
  assertBelow: () => Promise.resolve(),
  hit: () => Promise.resolve(1),
  reset: () => Promise.resolve(),
  remember: () => Promise.resolve(),
  rememberOnce: () => Promise.resolve(true),
  recall: () => Promise.resolve(null),
  onModuleDestroy: () => Promise.resolve(),
};

/** Sustituye a CorreoModule (BullMQ/Redis y worker SMTP) en las pruebas e2e. */
@Module({})
class CorreoE2eModule {}

/** Sustituye a ImportacionesModule (BullMQ/Redis); las pruebas que lo necesitan montan sus controladores. */
@Module({})
class ImportacionesE2eModule {}

/**
 * Módulo de pruebas e2e sin Redis ni BullMQ. La aplicación no tiene modo de prueba en tiempo
 * de ejecución: la composición sin infraestructura externa se hace aquí, en el módulo de pruebas.
 */
export function createE2eTestingModule(metadata: ModuleMetadata): TestingModuleBuilder {
  return Test.createTestingModule(metadata)
    .overrideProvider(AuthRateLimiterService).useValue(limitadorSinRedis)
    // Colas BullMQ sin Redis: ninguna cola ni worker abre conexiones durante las pruebas.
    .overrideProvider(getQueueToken(COLA_TRANSICIONES_PERIODO)).useValue({ upsertJobScheduler: async () => undefined })
    .overrideProvider(getQueueToken('limpieza-archivos')).useValue({ add: async () => undefined })
    .overrideProvider(getQueueToken('exportaciones')).useValue({ add: async () => undefined })
    .overrideProvider(TransicionesPeriodoWorker).useValue({})
    .overrideProvider(ArchivoLimpiezaWorker).useValue({})
    .overrideProvider(ExportacionesWorker).useValue({})
    .overrideModule(CorreoModule).useModule(CorreoE2eModule)
    .overrideModule(ImportacionesModule).useModule(ImportacionesE2eModule);
}
