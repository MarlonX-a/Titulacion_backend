import { describe, expect, it } from 'vitest';
import { validateEnvironment } from './environment.js';

const db = { DB_USERNAME: 'test_user', DB_PASSWORD: 'test_password', DB_NAME: 'test_database' };

describe('validateEnvironment', () => {
  it('usa valores predeterminados seguros en desarrollo', () => {
    expect(validateEnvironment(db)).toMatchObject({ NODE_ENV: 'development', PORT: 3000, SWAGGER_ENABLED: true, DB_SCHEMA: 'titulacion_dev', AUTH_ISSUER: 'http://127.0.0.1:3000', AUTH_ORIGINS: [] });
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

});
