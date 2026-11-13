import { BadRequestException, ConflictException, Logger, ServiceUnavailableException, type ArgumentsHost } from '@nestjs/common';
import type { AbstractHttpAdapter } from '@nestjs/core';
import { vi } from 'vitest';
import { LimitadorNoDisponibleException } from '../exceptions/limitador-no-disponible.exception.js';
import { ServerErrorLoggingFilter } from './server-error-logging.filter.js';

function setup() {
  const adapter = { reply: vi.fn(), isHeadersSent: vi.fn().mockReturnValue(false), end: vi.fn() };
  const request = { method: 'GET', originalUrl: '/api/v1/temas?token=secreto', url: '/temas', body: { password: 'nunca' }, headers: { authorization: 'Bearer secreto' } };
  const response = {};
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    getArgByIndex: (index: number) => (index === 0 ? request : response),
  } as unknown as ArgumentsHost;
  const filter = new ServerErrorLoggingFilter(adapter as unknown as AbstractHttpAdapter);
  const logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  return { adapter, host, filter, logError, response };
}

describe('ServerErrorLoggingFilter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registra método, ruta, estado, mensaje y causa de un 5xx sin datos sensibles', () => {
    const { adapter, host, filter, logError, response } = setup();
    const cause = new Error('column tema.tipo does not exist');
    const exception = new ServiceUnavailableException('El servicio no está disponible.', { cause });

    filter.catch(exception, host);

    expect(logError).toHaveBeenCalledTimes(1);
    const [message, stack] = logError.mock.calls[0] as [string, string];
    expect(message).toContain('GET /api/v1/temas -> 503');
    expect(message).toContain('El servicio no está disponible.');
    expect(message).toContain('column tema.tipo does not exist');
    expect(stack).toBe(cause.stack);
    const logged = JSON.stringify(logError.mock.calls);
    expect(logged).not.toContain('secreto');
    expect(logged).not.toContain('nunca');
    expect(adapter.reply).toHaveBeenCalledWith(response, exception.getResponse(), 503);
  });

  it('[VAL-004] no registra por solicitud el 503 del limitador con Redis caído y conserva la respuesta', () => {
    const { adapter, host, filter, logError, response } = setup();
    const logWarn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const exception = new LimitadorNoDisponibleException(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));

    for (let i = 0; i < 50; i += 1) filter.catch(exception, host);

    expect(logError).not.toHaveBeenCalled();
    expect(logWarn).not.toHaveBeenCalled();
    expect(adapter.reply).toHaveBeenCalledTimes(50);
    expect(adapter.reply).toHaveBeenCalledWith(response, exception.getResponse(), 503);
  });

  it('cualquier otro 503 con el mismo mensaje sigue registrándose', () => {
    const { host, filter, logError } = setup();

    filter.catch(new ServiceUnavailableException('El servicio de autenticación no está disponible.'), host);

    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('no registra errores 4xx y conserva la respuesta', () => {
    const { adapter, host, filter, logError, response } = setup();

    filter.catch(new BadRequestException('Dato inválido.'), host);
    filter.catch(new ConflictException('Ya existe.'), host);

    expect(logError).not.toHaveBeenCalled();
    expect(adapter.reply).toHaveBeenCalledWith(response, expect.objectContaining({ statusCode: 400, message: 'Dato inválido.' }), 400);
    expect(adapter.reply).toHaveBeenCalledWith(response, expect.objectContaining({ statusCode: 409 }), 409);
  });

  it('responde los 4xx de body-parser con su estado y sin registrarlos como error', () => {
    const { adapter, host, filter, logError, response } = setup();
    const tooLarge = Object.assign(new Error('request entity too large'), { status: 413, statusCode: 413, expose: true, type: 'entity.too.large' });

    filter.catch(tooLarge, host);

    expect(logError).not.toHaveBeenCalled();
    expect(adapter.reply).toHaveBeenCalledWith(response, expect.objectContaining({ statusCode: 413, message: 'El cuerpo de la solicitud supera el tamaño permitido.' }), 413);
  });

  describe('carga interrumpida por el cliente', () => {
    const abortar = (request: object, señal: Record<string, unknown> = { aborted: true }) => Object.assign(request, señal);
    const solicitud = (host: ArgumentsHost) => host.switchToHttp().getRequest<Record<string, unknown>>();

    it.each([
      ['Request aborted de multer', () => new Error('Request aborted'), { aborted: true }],
      ['Request aborted con la solicitud destruida', () => new Error('Request aborted'), { destroyed: true }],
      ['STREAM_DESTROYED de multer', () => Object.assign(new Error('File stream was destroyed'), { name: 'MulterError', code: 'STREAM_DESTROYED' }), { readableAborted: true }],
    ])('%s: responde 4xx y no lo registra como error de servidor', (_caso, crear, señal) => {
      const { adapter, host, filter, logError, response } = setup();
      const logWarn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const logDebug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
      abortar(solicitud(host), señal);

      filter.catch(crear(), host);

      expect(logError).not.toHaveBeenCalled();
      expect(logWarn).not.toHaveBeenCalled();
      expect(logDebug).toHaveBeenCalledWith('GET /api/v1/temas: carga interrumpida por el cliente.');
      const [, body, status] = adapter.reply.mock.calls[0] as [unknown, { statusCode: number }, number];
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
      expect(body.statusCode).toBe(status);
      expect(adapter.reply).toHaveBeenCalledWith(response, expect.objectContaining({ statusCode: 400 }), 400);
    });

    it('un "Request aborted" sin la solicitud abortada sigue siendo un 500 registrado', () => {
      const { adapter, host, filter, logError, response } = setup();

      filter.catch(new Error('Request aborted'), host);

      expect(logError).toHaveBeenCalledWith('GET /api/v1/temas -> 500');
      expect(adapter.reply).toHaveBeenCalledWith(response, { statusCode: 500, message: 'Internal server error' }, 500);
    });

    it('un error real de almacenamiento durante una solicitud abortada sigue siendo un 500 registrado', () => {
      const { adapter, host, filter, logError, response } = setup();
      abortar(solicitud(host));

      filter.catch(Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }), host);
      filter.catch(Object.assign(new Error('Too many parts'), { name: 'MulterError', code: 'LIMIT_PART_COUNT' }), host);

      expect(logError).toHaveBeenCalledWith('GET /api/v1/temas -> 500');
      expect(adapter.reply).toHaveBeenCalledWith(response, { statusCode: 500, message: 'Internal server error' }, 500);
      expect(adapter.reply).not.toHaveBeenCalledWith(response, expect.anything(), 400);
    });
  });

  it('añade la ruta a los errores desconocidos y responde 500 como el filtro base', () => {
    const { adapter, host, filter, logError, response } = setup();

    filter.catch(new Error('fallo inesperado'), host);

    expect(logError).toHaveBeenCalledWith('GET /api/v1/temas -> 500');
    expect(adapter.reply).toHaveBeenCalledWith(response, { statusCode: 500, message: 'Internal server error' }, 500);
  });
});
