import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { HttpStatus, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { vi } from 'vitest';
import type { AppEnvironment } from '../config/environment.js';
import { LimitadorNoDisponibleException } from '../common/exceptions/limitador-no-disponible.exception.js';
import { AuthRateLimiterService } from './auth-rate-limiter.service.js';

function limiterWith(redis: { get?: unknown; eval?: unknown; set?: unknown; del?: unknown; ping?: unknown }) {
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

  it('aplica los límites aunque NODE_ENV sea test (sin modo de prueba en tiempo de ejecución)', async () => {
    const config = new ConfigService<AppEnvironment, true>({ NODE_ENV: 'test', REDIS_PORT: 6379 } as AppEnvironment);
    const limiter = new AuthRateLimiterService(config);
    const evalMock = vi.fn().mockResolvedValue(2);
    Object.assign(limiter, { redis: { status: 'ready', quit: vi.fn().mockResolvedValue('OK'), eval: evalMock } });

    await expect(limiter.enforce('k', 1, 60)).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
    expect(evalMock).toHaveBeenCalledTimes(1);
  });

  it('construye la conexión con REDIS_PASSWORD y REDIS_TLS', async () => {
    const config = new ConfigService<AppEnvironment, true>({ NODE_ENV: 'production', REDIS_HOST: 'redis.interna', REDIS_PORT: 6380, REDIS_PASSWORD: 'clave-ficticia', REDIS_TLS: true } as AppEnvironment);
    const limiter = new AuthRateLimiterService(config);
    const options = (limiter as unknown as { redis: { options: { host: string; port: number; password?: string; tls?: object } } }).redis.options;
    expect(options).toMatchObject({ host: 'redis.interna', port: 6380, password: 'clave-ficticia', tls: {} });
    await limiter.onModuleDestroy();
  });

  it('sin contraseña ni TLS no envía AUTH ni negocia TLS', async () => {
    const config = new ConfigService<AppEnvironment, true>({ NODE_ENV: 'development', REDIS_PORT: 6379, REDIS_TLS: false } as AppEnvironment);
    const limiter = new AuthRateLimiterService(config);
    const options = (limiter as unknown as { redis: { options: { password?: string; tls?: object } } }).redis.options;
    expect(options.password).toBeFalsy();
    expect(options.tls).toBeFalsy();
    await limiter.onModuleDestroy();
  });

  it('falla cerrado con 503 si Redis no responde', async () => {
    const limiter = limiterWith({ get: vi.fn().mockRejectedValue(new Error('down')), eval: vi.fn().mockRejectedValue(new Error('down')) });

    await expect(limiter.assertBelow('k', 1)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(limiter.hit('k', 60)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('hit devuelve el total de la ventana', async () => {
    const limiter = limiterWith({ eval: vi.fn().mockResolvedValue(7) });

    await expect(limiter.hit('login-email-total:abc', 3600)).resolves.toBe(7);
  });

  it('reset elimina la clave', async () => {
    const del = vi.fn().mockResolvedValue(1);
    const limiter = limiterWith({ del });

    await limiter.reset('login-dev-fail:abc');

    expect(del).toHaveBeenCalledWith('titulacion:auth-rate:login-dev-fail:abc');
  });

  it('remember guarda con vencimiento y recall lo devuelve', async () => {
    const set = vi.fn().mockResolvedValue('OK');
    const limiter = limiterWith({ set, get: vi.fn().mockResolvedValue('digest') });

    await limiter.remember('device:abc', 'digest', 90);

    expect(set).toHaveBeenCalledWith('titulacion:auth-rate:device:abc', 'digest', 'EX', 90);
    await expect(limiter.recall('device:abc')).resolves.toBe('digest');
  });

  it('rememberOnce usa SET NX y devuelve si creó la marca', async () => {
    const set = vi.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    const limiter = limiterWith({ set });

    await expect(limiter.rememberOnce('evt:abc', 900)).resolves.toBe(true);
    await expect(limiter.rememberOnce('evt:abc', 900)).resolves.toBe(false);
    expect(set).toHaveBeenCalledWith('titulacion:auth-rate:evt:abc', '1', 'EX', 900, 'NX');
  });

  describe('reserva atómica (inicio de sesión)', () => {
    it('reserve devuelve true si el script reservó el cupo y false si el contador estaba lleno', async () => {
      const evalMock = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0);
      const limiter = limiterWith({ eval: evalMock });

      await expect(limiter.reserve('login-email-fail:abc', 10, 900)).resolves.toBe(true);
      await expect(limiter.reserve('login-email-fail:abc', 10, 900)).resolves.toBe(false);
      expect(evalMock).toHaveBeenCalledWith(expect.stringContaining('DECR'), 1, 'titulacion:auth-rate:login-email-fail:abc', '10', '900');
    });

    it('release devuelve un cupo con un script que nunca deja el contador negativo', async () => {
      const evalMock = vi.fn().mockResolvedValue(0);
      const limiter = limiterWith({ eval: evalMock });

      await limiter.release('login-email-fail:abc');

      expect(evalMock).toHaveBeenCalledWith(expect.stringContaining('DECR'), 1, 'titulacion:auth-rate:login-email-fail:abc');
    });

    it('reserve falla cerrado con 503 y conserva la causa', async () => {
      const causa = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6390'), { code: 'ECONNREFUSED' });
      const limiter = limiterWith({ eval: vi.fn().mockRejectedValue(causa) });

      const error = await limiter.reserve('k', 1, 60).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).cause).toBe(causa);
    });

    it('[VAL-004] el 503 por Redis caído es identificable (LimitadorNoDisponibleException) en todas las operaciones', async () => {
      const causa = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6390'), { code: 'ECONNREFUSED' });
      const limiter = limiterWith({ eval: vi.fn().mockRejectedValue(causa), get: vi.fn().mockRejectedValue(causa), set: vi.fn().mockRejectedValue(causa) });
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      for (const operacion of [
        () => limiter.enforce('k', 1, 60), () => limiter.reserve('k', 1, 60), () => limiter.assertBelow('k', 1),
        () => limiter.hit('k', 60), () => limiter.remember('k', 'v', 60), () => limiter.recall('k'),
      ]) {
        const error = await operacion().then(() => undefined, (caught: unknown) => caught);
        expect(error).toBeInstanceOf(LimitadorNoDisponibleException);
        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect((error as LimitadorNoDisponibleException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        expect((error as LimitadorNoDisponibleException).cause).toBe(causa);
      }
      vi.restoreAllMocks();
    });

    it('[VAL-004] un 429 no se convierte en LimitadorNoDisponibleException', async () => {
      const limiter = limiterWith({ eval: vi.fn().mockResolvedValue(2) });

      const error = await limiter.enforce('k', 1, 60).catch((caught: unknown) => caught);
      expect(error).not.toBeInstanceOf(LimitadorNoDisponibleException);
      expect(error).toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
    });
  });

  describe('Redis caído', () => {
    const caido = () => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6390'), { code: 'ECONNREFUSED' });
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

    it('enforce con siRedisFalla: permitir deja pasar la solicitud; por defecto responde 503', async () => {
      const limiter = limiterWith({ eval: vi.fn().mockRejectedValue(caido()) });

      await expect(limiter.enforce('rl:global:10.0.0.1', 3000, 60, { siRedisFalla: 'permitir' })).resolves.toBeUndefined();
      await expect(limiter.enforce('rl:subir-pat:u', 10, 3600)).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('con siRedisFalla: permitir el 429 se sigue aplicando', async () => {
      const limiter = limiterWith({ eval: vi.fn().mockResolvedValue(3001) });

      await expect(limiter.enforce('rl:global:10.0.0.1', 3000, 60, { siRedisFalla: 'permitir' })).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
    });

    it('registra la causa como máximo una vez cada 30 s, sin la contraseña, y una línea al recuperarse', async () => {
      vi.useFakeTimers();
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const evalMock = vi.fn().mockRejectedValue(caido());
      const config = new ConfigService<AppEnvironment, true>({ NODE_ENV: 'development', REDIS_PORT: 6390, REDIS_PASSWORD: 'clave-ficticia-larga' } as AppEnvironment);
      const limiter = new AuthRateLimiterService(config);
      Object.assign(limiter, { redis: { status: 'ready', quit: vi.fn().mockResolvedValue('OK'), eval: evalMock } });

      for (let i = 0; i < 5; i += 1) await limiter.enforce('k', 1, 60, { siRedisFalla: 'permitir' });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('ECONNREFUSED');
      expect(String(warn.mock.calls[0]?.[0])).not.toContain('clave-ficticia-larga');

      vi.advanceTimersByTime(29_000);
      await limiter.enforce('k', 1, 60, { siRedisFalla: 'permitir' });
      expect(warn).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2_000);
      await limiter.enforce('k', 1, 60, { siRedisFalla: 'permitir' });
      expect(warn).toHaveBeenCalledTimes(2);

      evalMock.mockResolvedValue(1);
      await limiter.enforce('k', 1, 60, { siRedisFalla: 'permitir' });
      await limiter.enforce('k', 1, 60, { siRedisFalla: 'permitir' });
      expect(log.mock.calls.filter((call) => String(call[0]).includes('Redis'))).toHaveLength(1);
    });

    it('al arrancar comprueba Redis con un comando y solo advierte si falla', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const limiter = limiterWith({ ping: vi.fn().mockRejectedValue(Object.assign(new Error('WRONGPASS invalid username-password pair'), { name: 'ReplyError' })) });

      await expect(limiter.comprobarConexion()).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('WRONGPASS');
    });
  });

  describe('Redis conectado pero mudo (RES-002)', () => {
    let servidor: Server;
    let puerto: number;
    const sockets: Socket[] = [];

    beforeAll(async () => {
      servidor = createServer((socket) => { sockets.push(socket); socket.on('error', () => undefined); });
      await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
      puerto = (servidor.address() as AddressInfo).port;
    });
    afterAll(async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => servidor.close(() => resolve()));
    });

    /** Resultado de la operación o `'sin respuesta'` si no termina dentro del plazo. */
    const conPlazo = async <T>(operacion: Promise<T>, ms: number): Promise<{ estado: 'resuelta' | 'rechazada' | 'sin respuesta'; error?: unknown; ms: number }> => {
      const inicio = Date.now();
      let temporizador: NodeJS.Timeout | undefined;
      const plazo = new Promise<'sin respuesta'>((resolve) => { temporizador = setTimeout(() => resolve('sin respuesta'), ms); });
      const resultado = await Promise.race([
        operacion.then(() => ({ estado: 'resuelta' as const }), (error: unknown) => ({ estado: 'rechazada' as const, error })),
        plazo.then((estado) => ({ estado })),
      ]);
      clearTimeout(temporizador);
      return { ...resultado, ms: Date.now() - inicio };
    };

    it('una solicitud no queda colgada: falla rápido (503 o deja pasar según el modo)', async () => {
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const config = new ConfigService<AppEnvironment, true>({ NODE_ENV: 'development', REDIS_HOST: '127.0.0.1', REDIS_PORT: puerto } as AppEnvironment);
      const limiter = new AuthRateLimiterService(config);
      try {
        const cerrado = await conPlazo(limiter.enforce('rl:subir-pat:u', 10, 3600), 3_000);
        expect(cerrado.estado, `enforce no terminó en ${cerrado.ms} ms`).toBe('rechazada');
        expect(cerrado.error).toBeInstanceOf(ServiceUnavailableException);
        const abierto = await conPlazo(limiter.enforce('rl:global:10.0.0.1', 3000, 60, { siRedisFalla: 'permitir' }), 3_000);
        expect(abierto.estado, `enforce (permitir) no terminó en ${abierto.ms} ms`).toBe('resuelta');
        const reserva = await conPlazo(limiter.reserve('login-email-fail:abc', 10, 900), 3_000);
        expect(reserva.estado, `reserve no terminó en ${reserva.ms} ms`).toBe('rechazada');
      } finally {
        await conPlazo(limiter.onModuleDestroy(), 1_000);
        vi.restoreAllMocks();
      }
    }, 15_000);

    it('si Redis deja de responder después de conectar, cada comando falla por plazo (sin colgar la solicitud)', async () => {
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      let mudo = false;
      const conexiones: Socket[] = [];
      /** Primer comando RESP completo de `texto`: nombre y longitud consumida, o `null` si falta. */
      const leerComando = (texto: string): { nombre: string; largo: number } | null => {
        const cabecera = /^\*(\d+)\r\n/.exec(texto);
        if (!cabecera) return null;
        let posicion = cabecera[0].length;
        let nombre = '';
        for (let i = 0; i < Number(cabecera[1]); i += 1) {
          const bulto = /^\$(\d+)\r\n/.exec(texto.slice(posicion));
          if (!bulto) return null;
          const inicio = posicion + bulto[0].length;
          if (texto.length < inicio + Number(bulto[1]) + 2) return null;
          if (i === 0) nombre = texto.slice(inicio, inicio + Number(bulto[1])).toLowerCase();
          posicion = inicio + Number(bulto[1]) + 2;
        }
        return { nombre, largo: posicion };
      };
      // Servidor RESP mínimo: responde el saludo de ioredis (CLIENT, INFO) y EVAL hasta quedarse mudo.
      const respondedor = createServer((socket) => {
        conexiones.push(socket);
        socket.on('error', () => undefined);
        let pendiente = '';
        socket.on('data', (datos) => {
          pendiente += datos.toString('latin1');
          for (let comando = leerComando(pendiente); comando; comando = leerComando(pendiente)) {
            pendiente = pendiente.slice(comando.largo);
            if (!mudo) socket.write(comando.nombre === 'info' ? '$11\r\nloading:0\r\n\r\n' : comando.nombre === 'eval' ? ':1\r\n' : '+OK\r\n');
          }
        });
      });
      await new Promise<void>((resolve) => respondedor.listen(0, '127.0.0.1', resolve));
      const config = new ConfigService<AppEnvironment, true>({ NODE_ENV: 'development', REDIS_HOST: '127.0.0.1', REDIS_PORT: (respondedor.address() as AddressInfo).port } as AppEnvironment);
      const limiter = new AuthRateLimiterService(config);
      try {
        expect((await conPlazo(limiter.enforce('rl:subir-pat:u', 10, 3600), 3_000)).estado).toBe('resuelta');
        mudo = true;
        const cerrado = await conPlazo(limiter.enforce('rl:subir-pat:u', 10, 3600), 3_000);
        expect(cerrado.estado, `enforce no terminó en ${cerrado.ms} ms`).toBe('rechazada');
        expect(cerrado.error).toBeInstanceOf(ServiceUnavailableException);
        expect((await conPlazo(limiter.enforce('rl:global:u', 600, 60, { siRedisFalla: 'permitir' }), 3_000)).estado).toBe('resuelta');
      } finally {
        await conPlazo(limiter.onModuleDestroy(), 1_000);
        for (const socket of conexiones) socket.destroy();
        await new Promise<void>((resolve) => respondedor.close(() => resolve()));
        vi.restoreAllMocks();
      }
    }, 15_000);
  });

  it('las operaciones de registro también fallan cerrado con 503', async () => {
    const down = vi.fn().mockRejectedValue(new Error('down'));
    const limiter = limiterWith({ get: down, set: down, del: down });

    await expect(limiter.recall('k')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(limiter.remember('k', 'v', 1)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(limiter.rememberOnce('k', 1)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(limiter.reset('k')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
