import { HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { vi } from 'vitest';
import type { AppEnvironment } from '../config/environment.js';
import { AuthRateLimiterService } from './auth-rate-limiter.service.js';

function limiterWith(redis: { get?: unknown; eval?: unknown }) {
  const config = new ConfigService<AppEnvironment, true>({ NODE_ENV: 'development', REDIS_PORT: 6379 } as AppEnvironment);
  const limiter = new AuthRateLimiterService(config);
  // Sustituye el cliente real para no abrir conexiones durante la prueba.
  Object.assign(limiter, { redis: { status: 'ready', quit: vi.fn().mockResolvedValue('OK'), ...redis } });
  return limiter;
}

describe('AuthRateLimiterService', () => {
  it('assertBelow permite mientras el contador no alcanza el límite y no lo incrementa', async () => {
    const evalMock = vi.fn();
    const limiter = limiterWith({ get: vi.fn().mockResolvedValue('29'), eval: evalMock });

    await expect(limiter.assertBelow('login-ip-failures:10.0.0.1', 30)).resolves.toBeUndefined();
    expect(evalMock).not.toHaveBeenCalled();
  });

  it('assertBelow responde 429 cuando el contador alcanzó el límite', async () => {
    const limiter = limiterWith({ get: vi.fn().mockResolvedValue('30') });

    await expect(limiter.assertBelow('login-ip-failures:10.0.0.1', 30)).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
  });

  it('assertBelow permite cuando la clave no existe', async () => {
    const limiter = limiterWith({ get: vi.fn().mockResolvedValue(null) });

    await expect(limiter.assertBelow('login-ip-failures:10.0.0.1', 30)).resolves.toBeUndefined();
  });

  it('hit incrementa el contador con la ventana indicada', async () => {
    const evalMock = vi.fn().mockResolvedValue(1);
    const limiter = limiterWith({ eval: evalMock });

    await limiter.hit('login-ip-failures:10.0.0.1', 60);

    expect(evalMock).toHaveBeenCalledWith(expect.any(String), 1, 'titulacion:auth-rate:login-ip-failures:10.0.0.1', '60');
  });

  it('enforce cuenta cada solicitud y responde 429 al superar el límite', async () => {
    const limiter = limiterWith({ eval: vi.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(11) });

    await expect(limiter.enforce('login-email:abc', 10, 60)).resolves.toBeUndefined();
    await expect(limiter.enforce('login-email:abc', 10, 60)).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
  });

  it('falla cerrado con 503 si Redis no responde', async () => {
    const limiter = limiterWith({ get: vi.fn().mockRejectedValue(new Error('down')), eval: vi.fn().mockRejectedValue(new Error('down')) });

    await expect(limiter.assertBelow('k', 1)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(limiter.hit('k', 60)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
