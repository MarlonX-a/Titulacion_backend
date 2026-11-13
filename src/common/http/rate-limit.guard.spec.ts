import { EventEmitter } from 'node:events';
import { HttpException, HttpStatus, Logger, ServiceUnavailableException, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { vi } from 'vitest';
import { AppController } from '../../app.controller.js';
import { AuthRateLimiterService } from '../../auth/auth-rate-limiter.service.js';
import type { AppEnvironment } from '../../config/environment.js';
import { LIMITE_GLOBAL_IP, LIMITE_GLOBAL_USUARIO, RateLimit } from './rate-limit.decorator.js';
import { RateLimitGuard } from './rate-limit.guard.js';

const userId = '00000000-0000-4000-8000-000000000001';

function contextFor(request: object, handler: () => void = () => undefined, type = 'http'): ExecutionContext {
  class Controlador {}
  return {
    getType: () => type, getHandler: () => handler, getClass: () => Controlador,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function setup(enforce = vi.fn().mockResolvedValue(undefined)) {
  const guard = new RateLimitGuard(new Reflector(), { enforce } as unknown as AuthRateLimiterService);
  return { guard, enforce };
}

describe('RateLimitGuard', () => {
  it('aplica el límite global por usuario a una solicitud autenticada sin @RateLimit', async () => {
    const { guard, enforce } = setup();
    await expect(guard.canActivate(contextFor({ ip: '10.0.0.1', usuario: { id: userId } }))).resolves.toBe(true);
    expect(enforce).toHaveBeenCalledWith(`rl:global:${userId}`, LIMITE_GLOBAL_USUARIO.limite, LIMITE_GLOBAL_USUARIO.ventanaSegundos, { siRedisFalla: 'permitir' });
  });

  it('aplica el límite global por IP (más alto, por NAT) a una solicitud anónima', async () => {
    const { guard, enforce } = setup();
    await guard.canActivate(contextFor({ ip: '203.0.113.9', headers: { 'x-forwarded-for': '1.2.3.4' } }));
    expect(enforce).toHaveBeenCalledWith('rl:global:203.0.113.9', LIMITE_GLOBAL_IP.limite, LIMITE_GLOBAL_IP.ventanaSegundos, { siRedisFalla: 'permitir' });
    expect(LIMITE_GLOBAL_IP.limite).toBeGreaterThan(LIMITE_GLOBAL_USUARIO.limite);
  });

  it('usa el límite declarado con @RateLimit por usuario', async () => {
    class Controlador { subir(): void { /* ruta de prueba */ } }
    RateLimit({ clave: 'subir-pat', limite: 10, ventanaSegundos: 3600 })(Controlador.prototype, 'subir', Object.getOwnPropertyDescriptor(Controlador.prototype, 'subir')!);
    const { guard, enforce } = setup();
    await guard.canActivate(contextFor({ ip: '10.0.0.1', usuario: { id: userId } }, Controlador.prototype.subir));
    expect(enforce).toHaveBeenCalledWith(`rl:subir-pat:${userId}`, 10, 3600, { siRedisFalla: 'rechazar' });
  });

  it('con por: ip cuenta por dirección aunque haya sesión; un token de primer acceso cuenta por su sujeto', async () => {
    class Controlador { porIp(): void { /* ruta de prueba */ } }
    RateLimit({ clave: 'exportar', limite: 5, ventanaSegundos: 60, por: 'ip' })(Controlador.prototype, 'porIp', Object.getOwnPropertyDescriptor(Controlador.prototype, 'porIp')!);
    const { guard, enforce } = setup();
    await guard.canActivate(contextFor({ ip: '10.0.0.7', usuario: { id: userId } }, Controlador.prototype.porIp));
    expect(enforce).toHaveBeenLastCalledWith('rl:exportar:10.0.0.7', 5, 60, { siRedisFalla: 'rechazar' });
    await guard.canActivate(contextFor({ ip: '10.0.0.7', user: { subject: userId, firstAccess: true } }));
    expect(enforce).toHaveBeenLastCalledWith(`rl:global:${userId}`, LIMITE_GLOBAL_USUARIO.limite, LIMITE_GLOBAL_USUARIO.ventanaSegundos, { siRedisFalla: 'permitir' });
  });

  it('propaga el 429 del limitador', async () => {
    const tooMany = new HttpException('Se alcanzó el límite de solicitudes. Inténtalo más tarde.', HttpStatus.TOO_MANY_REQUESTS);
    const { guard } = setup(vi.fn().mockRejectedValue(tooMany));
    await expect(guard.canActivate(contextFor({ ip: '10.0.0.1' }))).rejects.toBe(tooMany);
  });

  describe('con Redis caído', () => {
    function guardConRedisCaido() {
      const config = new ConfigService<AppEnvironment, true>({ NODE_ENV: 'development', REDIS_PORT: 6379 } as AppEnvironment);
      const limiter = new AuthRateLimiterService(config);
      const caido = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), { code: 'ECONNREFUSED' });
      Object.assign(limiter, { redis: { status: 'ready', quit: vi.fn().mockResolvedValue('OK'), eval: vi.fn().mockRejectedValue(caido) } });
      return { guard: new RateLimitGuard(new Reflector(), limiter), caido };
    }
    beforeEach(() => { vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('una ruta sin @RateLimit (límite global) sigue respondiendo', async () => {
      const { guard } = guardConRedisCaido();
      await expect(guard.canActivate(contextFor({ ip: '10.0.0.1', usuario: { id: userId } }))).resolves.toBe(true);
      await expect(guard.canActivate(contextFor({ ip: '10.0.0.1' }))).resolves.toBe(true);
    });

    it('GET /healthz responde aunque Redis no esté disponible', async () => {
      const { guard } = guardConRedisCaido();
      await expect(guard.canActivate(contextFor({ ip: '10.0.0.1' }, AppController.prototype.healthz))).resolves.toBe(true);
    });

    it('una ruta con @RateLimit falla cerrado con 503 y conserva la causa', async () => {
      class Controlador { subir(): void { /* ruta de prueba */ } }
      RateLimit({ clave: 'subir-pat', limite: 10, ventanaSegundos: 3600 })(Controlador.prototype, 'subir', Object.getOwnPropertyDescriptor(Controlador.prototype, 'subir')!);
      const { guard, caido } = guardConRedisCaido();
      const error = await guard.canActivate(contextFor({ ip: '10.0.0.1', usuario: { id: userId } }, Controlador.prototype.subir)).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).cause).toBe(caido);
    });
  });

  describe('concurrencia por usuario (@RateLimit con concurrencia)', () => {
    class Controlador { subir(): void { /* ruta de prueba */ } }
    RateLimit({ clave: 'subir-pat', limite: 10, ventanaSegundos: 3600, concurrencia: { limite: 1, ttlSegundos: 300 } })(Controlador.prototype, 'subir', Object.getOwnPropertyDescriptor(Controlador.prototype, 'subir')!);
    const clave = `rl:subir-pat:concurrentes:${userId}`;

    function contextoConRespuesta(response: EventEmitter & { writableFinished?: boolean; destroyed?: boolean }) {
      return {
        getType: () => 'http', getHandler: () => Controlador.prototype.subir, getClass: () => Controlador,
        switchToHttp: () => ({ getRequest: () => ({ ip: '10.0.0.1', usuario: { id: userId } }), getResponse: () => response }),
      } as unknown as ExecutionContext;
    }

    function limitador(reserve = vi.fn().mockResolvedValue(true), release = vi.fn().mockResolvedValue(undefined)) {
      const enforce = vi.fn().mockResolvedValue(undefined);
      return { guard: new RateLimitGuard(new Reflector(), { enforce, reserve, release } as unknown as AuthRateLimiterService), enforce, reserve, release };
    }

    it('toma un cupo con vencimiento después de contar el límite por ventana', async () => {
      const { guard, enforce, reserve } = limitador();
      await expect(guard.canActivate(contextoConRespuesta(new EventEmitter()))).resolves.toBe(true);
      expect(enforce).toHaveBeenCalledWith(`rl:subir-pat:${userId}`, 10, 3600, { siRedisFalla: 'rechazar' });
      // El vencimiento es la red de seguridad: un proceso caído no retiene el cupo para siempre.
      expect(reserve).toHaveBeenCalledWith(clave, 1, 300);
      expect(enforce.mock.invocationCallOrder[0]).toBeLessThan(reserve.mock.invocationCallOrder[0]!);
    });

    it('una segunda subida simultánea recibe 429 y no libera el cupo ajeno', async () => {
      const { guard, release } = limitador(vi.fn().mockResolvedValue(false));
      const response = new EventEmitter();
      const error = await guard.canActivate(contextoConRespuesta(response)).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      response.emit('finish');
      response.emit('close');
      expect(release).not.toHaveBeenCalled();
    });

    it('libera el cupo una sola vez cuando la respuesta termina', async () => {
      const { guard, release } = limitador();
      const response = new EventEmitter();
      await guard.canActivate(contextoConRespuesta(response));
      expect(release).not.toHaveBeenCalled();
      response.emit('finish');
      response.emit('close');
      await Promise.resolve();
      expect(release).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledWith(clave);
    });

    it('libera el cupo si la conexión se cierra antes de terminar (subida abortada)', async () => {
      const { guard, release } = limitador();
      const response = new EventEmitter();
      await guard.canActivate(contextoConRespuesta(response));
      response.emit('close');
      expect(release).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledWith(clave);
    });

    it('libera de inmediato si la conexión ya estaba cerrada al tomar el cupo', async () => {
      const { guard, release } = limitador();
      await guard.canActivate(contextoConRespuesta(Object.assign(new EventEmitter(), { destroyed: true })));
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('un fallo al liberar no propaga errores (el vencimiento libera el cupo)', async () => {
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const { guard, release } = limitador(undefined, vi.fn().mockRejectedValue(new ServiceUnavailableException()));
      const response = new EventEmitter();
      await guard.canActivate(contextoConRespuesta(response));
      response.emit('close');
      await new Promise((resolve) => setImmediate(resolve));
      expect(release).toHaveBeenCalledTimes(1);
      vi.restoreAllMocks();
    });

    it('con Redis caído falla cerrado con 503, igual que el límite por ventana', async () => {
      const caido = new ServiceUnavailableException('El servicio de autenticación no está disponible.');
      const { guard, release } = limitador(vi.fn().mockRejectedValue(caido));
      await expect(guard.canActivate(contextoConRespuesta(new EventEmitter()))).rejects.toBe(caido);
      expect(release).not.toHaveBeenCalled();
    });

    it('el decorador rechaza una concurrencia inválida', () => {
      expect(() => RateLimit({ clave: 'ok', limite: 1, ventanaSegundos: 1, concurrencia: { limite: 0, ttlSegundos: 60 } })).toThrow('concurrencia');
      expect(() => RateLimit({ clave: 'ok', limite: 1, ventanaSegundos: 1, concurrencia: { limite: 1, ttlSegundos: 0 } })).toThrow('concurrencia');
    });
  });

  it('ignora contextos que no son HTTP', async () => {
    const { guard, enforce } = setup();
    await expect(guard.canActivate(contextFor({}, undefined, 'rpc'))).resolves.toBe(true);
    expect(enforce).not.toHaveBeenCalled();
  });

  it('el decorador rechaza configuraciones inválidas', () => {
    expect(() => RateLimit({ clave: 'Con Espacios', limite: 1, ventanaSegundos: 1 })).toThrow('clave');
    expect(() => RateLimit({ clave: 'ok', limite: 0, ventanaSegundos: 1 })).toThrow('límite');
    expect(() => RateLimit({ clave: 'ok', limite: 1, ventanaSegundos: 1.5 })).toThrow('ventana');
  });
});
