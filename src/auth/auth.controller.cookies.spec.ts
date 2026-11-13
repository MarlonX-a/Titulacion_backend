import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { vi } from 'vitest';
import type { AppEnvironment } from '../config/environment.js';
import { AuthController } from './auth.controller.js';
import type { AuthenticationResult, AuthenticationService } from './authentication.service.js';
import { DEVICE_TTL_SECONDS } from './login-throttle.js';

const ORIGIN = 'https://titulacion.example.test';
const CSRF = 'c'.repeat(43);

function setup(nodeEnv: 'production' | 'development') {
  const result: AuthenticationResult = {
    response: { access_token: 'token', token_type: 'Bearer', expires_in: 900 },
    refresh_cookie: 'refresh-secreto',
    csrf_cookie: CSRF,
    device_cookie: 'dispositivo',
  } as unknown as AuthenticationResult;
  const authentication = {
    login: vi.fn().mockResolvedValue(result),
    refresh: vi.fn().mockResolvedValue({ ...result, device_cookie: undefined }),
    logout: vi.fn().mockResolvedValue(undefined),
  };
  const values: Record<string, unknown> = { NODE_ENV: nodeEnv, AUTH_ORIGINS: [ORIGIN], AUTH_ISSUER: ORIGIN };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService<AppEnvironment, true>;
  const controller = new AuthController(authentication as unknown as AuthenticationService, config);
  const headers = new Map<string, unknown>();
  const response = {
    setHeader: (name: string, value: unknown) => { headers.set(name.toLowerCase(), value); },
    getHeader: (name: string) => headers.get(name.toLowerCase()),
  } as unknown as Response;
  const cookies = (): string[] => {
    const value = headers.get('set-cookie');
    return Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
  };
  return { controller, authentication, response, cookies };
}

const request = (cookie?: string): Request => ({
  ip: '127.0.0.1',
  headers: { origin: ORIGIN, 'x-csrf-token': CSRF, ...(cookie ? { cookie } : {}) },
}) as unknown as Request;

/** Atributos de una línea Set-Cookie, en minúsculas y sin el par nombre=valor. */
function attributes(line: string): Map<string, string> {
  const [, ...parts] = line.split(';').map((part) => part.trim());
  return new Map(parts.map((part) => {
    const [key, ...rest] = part.split('=');
    return [key!.toLowerCase(), rest.join('=')];
  }));
}
const find = (lines: string[], name: string) => {
  const line = lines.find((item) => item.startsWith(`${name}=`));
  if (!line) throw new Error(`Falta la cookie ${name} en ${JSON.stringify(lines)}`);
  return line;
};

describe('AuthController: cookies de sesión en production', () => {
  it('login emite refresh, CSRF y dispositivo con prefijo __Secure- y los atributos esperados', async () => {
    const { controller, response, cookies } = setup('production');

    await controller.login({ email: 'docente@uleam.edu.ec', password: 'x' } as never, request(), response);

    const lines = cookies();
    expect(lines.every((line) => line.startsWith('__Secure-'))).toBe(true);
    const refresh = attributes(find(lines, '__Secure-titulacion_refresh'));
    expect(refresh.has('secure')).toBe(true);
    expect(refresh.has('httponly')).toBe(true);
    expect(refresh.get('samesite')).toBe('Strict');
    expect(refresh.get('path')).toBe('/auth');
    expect(refresh.has('max-age')).toBe(false);
    expect(refresh.has('expires')).toBe(false);
    expect(refresh.has('domain')).toBe(false);

    const csrf = attributes(find(lines, '__Secure-titulacion_csrf'));
    expect(csrf.has('secure')).toBe(true);
    expect(csrf.get('samesite')).toBe('Strict');
    expect(csrf.get('path')).toBe('/auth');
    expect(csrf.has('max-age')).toBe(false);
    expect(csrf.has('expires')).toBe(false);

    const device = attributes(find(lines, '__Secure-titulacion_dispositivo'));
    expect(device.has('secure')).toBe(true);
    expect(device.has('httponly')).toBe(true);
    expect(device.get('samesite')).toBe('Strict');
    expect(device.get('path')).toBe('/auth');
    expect(device.get('max-age')).toBe(String(DEVICE_TTL_SECONDS));
  });

  it('refresh solo acepta la cookie con prefijo y la rota con los mismos atributos', async () => {
    const { controller, authentication, response, cookies } = setup('production');

    await expect(controller.refresh(request(`titulacion_refresh=sin-prefijo; titulacion_csrf=${CSRF}`), response)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authentication.refresh).not.toHaveBeenCalled();

    await controller.refresh(request(`__Secure-titulacion_refresh=con-prefijo; __Secure-titulacion_csrf=${CSRF}`), response);
    expect(authentication.refresh).toHaveBeenCalledWith('con-prefijo', '127.0.0.1');
    const refresh = attributes(find(cookies(), '__Secure-titulacion_refresh'));
    expect(refresh.has('secure')).toBe(true);
    expect(refresh.has('httponly')).toBe(true);
    expect(refresh.get('samesite')).toBe('Strict');
    expect(refresh.get('path')).toBe('/auth');
    expect(refresh.has('max-age')).toBe(false);
  });

  it('logout borra las cookies con prefijo, Secure y la misma ruta', async () => {
    const { controller, response, cookies } = setup('production');

    await controller.logout(request(`__Secure-titulacion_refresh=r; __Secure-titulacion_csrf=${CSRF}`), response);

    for (const name of ['__Secure-titulacion_refresh', '__Secure-titulacion_csrf']) {
      const cleared = attributes(find(cookies(), name));
      expect(cleared.get('max-age')).toBe('0');
      expect(cleared.has('secure')).toBe(true);
      expect(cleared.get('path')).toBe('/auth');
    }
  });

  it('fuera de production no usa el prefijo ni Secure (el navegador lo exigiría sobre HTTP)', async () => {
    const { controller, response, cookies } = setup('development');

    await controller.login({ email: 'docente@uleam.edu.ec', password: 'x' } as never, request(), response);

    const lines = cookies();
    expect(lines.some((line) => line.startsWith('__Secure-'))).toBe(false);
    expect(attributes(find(lines, 'titulacion_refresh')).has('secure')).toBe(false);
  });
});
