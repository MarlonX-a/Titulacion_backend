import { describe, expect, it } from 'vitest';
import { assertRuntimeEnvironment, validateEnvironment } from './environment.js';

const db = { DB_USERNAME: 'test_user', DB_PASSWORD: 'test_password', DB_NAME: 'test_database' };
/** Entorno de producción mínimo y válido (rutas y valores ficticios). */
const produccion: Record<string, string> = {
  ...db, NODE_ENV: 'production', AUTH_ISSUER: 'https://titulacion.example.test', AUTH_ORIGINS: 'https://titulacion.example.test',
  JWT_PRIVATE_KEY_PATH: '/run/secrets/jwt-private.pem', JWT_PUBLIC_KEY_PATH: '/run/secrets/jwt-public.pem', OUTBOX_ENCRYPTION_KEY_PATH: '/run/secrets/outbox.key',
  REDIS_HOST: 'redis.interna', REDIS_PASSWORD: 'clave-ficticia', SMTP_HOST: 'smtp.example.test', SMTP_FROM: 'no-reply@example.test', S3_BUCKET: 'titulacion', TRUST_PROXY: '1',
};

describe('validateEnvironment', () => {
  it('usa valores predeterminados seguros en desarrollo', () => {
    expect(validateEnvironment(db)).toMatchObject({
      NODE_ENV: 'development', PORT: 3000, SWAGGER_ENABLED: false, DB_SCHEMA: 'titulacion_dev', AUTH_ISSUER: 'http://127.0.0.1:3000', AUTH_ORIGINS: [],
      REDIS_TLS: false, DB_SSL: false, DB_SSL_REJECT_UNAUTHORIZED: true, SMTP_REQUIRE_TLS: false,
    });
    expect(validateEnvironment(db)).not.toHaveProperty('REDIS_PASSWORD');
  });

  it('IMPORT_TEMP_TTL_HOURS vale 24 por defecto y admite enteros de 1 a 168', () => {
    expect(validateEnvironment(db).IMPORT_TEMP_TTL_HOURS).toBe(24);
    expect(validateEnvironment({ ...db, IMPORT_TEMP_TTL_HOURS: '' }).IMPORT_TEMP_TTL_HOURS).toBe(24);
    expect(validateEnvironment({ ...db, IMPORT_TEMP_TTL_HOURS: '1' }).IMPORT_TEMP_TTL_HOURS).toBe(1);
    expect(validateEnvironment({ ...db, IMPORT_TEMP_TTL_HOURS: '168' }).IMPORT_TEMP_TTL_HOURS).toBe(168);
    expect(validateEnvironment(produccion).IMPORT_TEMP_TTL_HOURS).toBe(24);
    for (const invalido of ['0', '169', '-3', '1.5', '12h', 'abc', '0x10']) {
      expect(() => validateEnvironment({ ...db, IMPORT_TEMP_TTL_HOURS: invalido }), invalido).toThrow('IMPORT_TEMP_TTL_HOURS');
    }
  });

  it('las tareas en segundo plano y la lectura de .env están activas salvo desactivación explícita', () => {
    expect(validateEnvironment(db)).toMatchObject({ BACKGROUND_TASKS_ENABLED: true, IGNORE_ENV_FILE: false });
    expect(validateEnvironment(produccion)).toMatchObject({ BACKGROUND_TASKS_ENABLED: true, IGNORE_ENV_FILE: false });
    expect(validateEnvironment({ ...db, BACKGROUND_TASKS_ENABLED: 'false', IGNORE_ENV_FILE: 'true' })).toMatchObject({ BACKGROUND_TASKS_ENABLED: false, IGNORE_ENV_FILE: true });
    expect(() => validateEnvironment({ ...db, BACKGROUND_TASKS_ENABLED: 'no' })).toThrow('BACKGROUND_TASKS_ENABLED');
    expect(() => validateEnvironment({ ...db, IGNORE_ENV_FILE: '1' })).toThrow('IGNORE_ENV_FILE');
  });

  it('[VAL-005] rechaza BACKGROUND_TASKS_ENABLED=false en producción con un mensaje claro', () => {
    expect(() => validateEnvironment({ ...produccion, BACKGROUND_TASKS_ENABLED: 'false' }))
      .toThrow('Configuración inválida: BACKGROUND_TASKS_ENABLED=false no se admite en production');
    expect(validateEnvironment({ ...produccion, BACKGROUND_TASKS_ENABLED: 'true' }).BACKGROUND_TASKS_ENABLED).toBe(true);
    expect(validateEnvironment({ ...db, NODE_ENV: 'test', BACKGROUND_TASKS_ENABLED: 'false' }).BACKGROUND_TASKS_ENABLED).toBe(false);
    expect(validateEnvironment({ ...db, NODE_ENV: 'development', BACKGROUND_TASKS_ENABLED: 'false' }).BACKGROUND_TASKS_ENABLED).toBe(false);
  });

  it('monta Swagger solo con SWAGGER_ENABLED=true explícito, también en producción', () => {
    expect(validateEnvironment({ ...db, SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED).toBe(true);
    expect(validateEnvironment({ ...db, SWAGGER_ENABLED: 'false' }).SWAGGER_ENABLED).toBe(false);
    expect(validateEnvironment(produccion).SWAGGER_ENABLED).toBe(false);
  });

  it('interpreta las opciones de transporte y rechaza valores no booleanos', () => {
    expect(validateEnvironment({ ...db, REDIS_PASSWORD: 'r3dis', REDIS_TLS: 'true', DB_SSL: 'true', DB_SSL_REJECT_UNAUTHORIZED: 'false', SMTP_REQUIRE_TLS: 'true' }))
      .toMatchObject({ REDIS_PASSWORD: 'r3dis', REDIS_TLS: true, DB_SSL: true, DB_SSL_REJECT_UNAUTHORIZED: false, SMTP_REQUIRE_TLS: true });
    for (const key of ['REDIS_TLS', 'DB_SSL', 'DB_SSL_REJECT_UNAUTHORIZED', 'SMTP_REQUIRE_TLS']) {
      expect(() => validateEnvironment({ ...db, [key]: '1' })).toThrow(key);
    }
  });

  it('en producción activa TLS de PostgreSQL y SMTP por defecto y permite desactivarlo explícitamente', () => {
    expect(validateEnvironment(produccion)).toMatchObject({ DB_SSL: true, DB_SSL_REJECT_UNAUTHORIZED: true, SMTP_REQUIRE_TLS: true, REDIS_TLS: false });
    expect(validateEnvironment({ ...produccion, DB_SSL: 'false', SMTP_REQUIRE_TLS: 'false' })).toMatchObject({ DB_SSL: false, SMTP_REQUIRE_TLS: false });
  });

  it('exige REDIS_PASSWORD en producción sin revelar su valor', () => {
    const { REDIS_PASSWORD: _omitida, ...sinClave } = produccion;
    expect(() => validateEnvironment(sinClave)).toThrow('REDIS_PASSWORD');
    expect(() => validateEnvironment({ ...produccion, REDIS_PASSWORD: '  ' })).toThrow('REDIS_PASSWORD');
  });

  it('en producción exige TRUST_PROXY explícito y rechaza true', () => {
    const { TRUST_PROXY: _omitido, ...sinProxy } = produccion;
    expect(() => validateEnvironment(sinProxy)).toThrow('TRUST_PROXY');
    expect(() => validateEnvironment({ ...produccion, TRUST_PROXY: ' ' })).toThrow('TRUST_PROXY');
    expect(() => validateEnvironment({ ...produccion, TRUST_PROXY: 'true' })).toThrow('TRUST_PROXY');
    expect(validateEnvironment({ ...produccion, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
    expect(validateEnvironment({ ...produccion, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
    expect(validateEnvironment({ ...produccion, TRUST_PROXY: '10.0.0.0/8' }).TRUST_PROXY).toBe('10.0.0.0/8');
  });

  it('assertRuntimeEnvironment rechaza NODE_ENV=test y acepta los modos de ejecución', () => {
    expect(() => assertRuntimeEnvironment('test')).toThrow('NODE_ENV=test');
    expect(() => assertRuntimeEnvironment('development')).not.toThrow();
    expect(() => assertRuntimeEnvironment('production')).not.toThrow();
    expect(() => assertRuntimeEnvironment(undefined)).not.toThrow();
  });

  it.each(['DB_USERNAME', 'DB_PASSWORD', 'DB_NAME'] as const)('exige %s', (key) => {
    expect(() => validateEnvironment({ ...db, [key]: '   ' })).toThrow(key);
  });

  it('exige ambas claves JWT en producción sin revelar rutas', () => {
    expect(() => validateEnvironment({ ...db, NODE_ENV: 'production', AUTH_ISSUER: 'https://auth.example.test' })).toThrow('claves JWT');
  });

  it('rechaza valores inválidos de puerto y opciones booleanas', () => {
    expect(() => validateEnvironment({ ...db, PORT: '0xBB8' })).toThrow('PORT');
    expect(() => validateEnvironment({ ...db, DB_PORT: '5432x' })).toThrow('DB_PORT');
    expect(() => validateEnvironment({ ...db, SWAGGER_ENABLED: 'yes' })).toThrow('SWAGGER_ENABLED');
  });

  it('valida issuer/orígenes seguros y no incluye secretos en errores', () => {
    expect(() => validateEnvironment({ ...db, AUTH_ISSUER: 'http://login.example.test', DB_PASSWORD: 'never-print-this' })).toThrow('AUTH_ISSUER');
    try { validateEnvironment({ ...db, AUTH_ISSUER: 'http://login.example.test', DB_PASSWORD: 'never-print-this' }); }
    catch (error) { expect(String(error)).not.toContain('never-print-this'); }
  });

  it('acepta HTTP únicamente en loopback y preserva contraseña de base de datos', () => {
    expect(validateEnvironment({ ...db, DB_PASSWORD: ' password:@/# ', AUTH_ISSUER: 'http://localhost:3100' }).DB_PASSWORD).toBe(' password:@/# ');
  });

  it('no confía en proxies si TRUST_PROXY se omite o está vacío', () => {
    expect(validateEnvironment(db).TRUST_PROXY).toBe(false);
    expect(validateEnvironment({ ...db, TRUST_PROXY: '  ' }).TRUST_PROXY).toBe(false);
  });

  it('interpreta TRUST_PROXY como booleano, saltos o lista de subredes', () => {
    expect(validateEnvironment({ ...db, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(validateEnvironment({ ...db, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
    expect(validateEnvironment({ ...db, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(validateEnvironment({ ...db, TRUST_PROXY: 'loopback,  10.0.0.0/8, fe80::/10' }).TRUST_PROXY).toBe('loopback, 10.0.0.0/8, fe80::/10');
  });

  it('rechaza TRUST_PROXY con caracteres no válidos', () => {
    expect(() => validateEnvironment({ ...db, TRUST_PROXY: 'loopback; rm' })).toThrow('TRUST_PROXY');
    expect(() => validateEnvironment({ ...db, TRUST_PROXY: 'loopback,,uniquelocal' })).toThrow('TRUST_PROXY');
  });

});
