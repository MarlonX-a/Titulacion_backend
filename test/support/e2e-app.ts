import { ConfigService } from '@nestjs/config';
import { vi } from 'vitest';
import type { AppEnvironment } from '../../src/config/environment.js';

/** Configuración mínima de la aplicación para pruebas e2e sin servicios externos. */
export function testConfigService(): ConfigService<AppEnvironment, true> {
  return new ConfigService<AppEnvironment, true>({
    NODE_ENV: 'test', PORT: 3000, SWAGGER_ENABLED: true, DB_HOST: '127.0.0.1', DB_PORT: 5432,
    DB_SCHEMA: 'test', DB_USERNAME: 'test_user', DB_PASSWORD: 'test_password', DB_NAME: 'test_database',
    AUTH_ISSUER: 'http://127.0.0.1:3000', AUTH_ORIGINS: [], REDIS_PORT: 6379, SMTP_PORT: 1025, S3_REGION: 'us-east-1',
  });
}

/** Sustituto de AuthenticationService: el token es la clave del mapa y resuelve al usuario asociado. */
export function tokenAuthenticationMock(tokens: Map<string, string>) {
  return { verifyToken: vi.fn((token: string) => Promise.resolve({ subject: tokens.get(token) ?? '', issuer: 'http://127.0.0.1:3000', firstAccess: false })) };
}
