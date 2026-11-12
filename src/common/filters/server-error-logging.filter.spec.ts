import { BadRequestException, ConflictException, Logger, ServiceUnavailableException, type ArgumentsHost } from '@nestjs/common';
import type { AbstractHttpAdapter } from '@nestjs/core';
import { vi } from 'vitest';
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

  it('no registra errores 4xx y conserva la respuesta', () => {
    const { adapter, host, filter, logError, response } = setup();

    filter.catch(new BadRequestException('Dato inválido.'), host);
    filter.catch(new ConflictException('Ya existe.'), host);

    expect(logError).not.toHaveBeenCalled();
    expect(adapter.reply).toHaveBeenCalledWith(response, expect.objectContaining({ statusCode: 400, message: 'Dato inválido.' }), 400);
    expect(adapter.reply).toHaveBeenCalledWith(response, expect.objectContaining({ statusCode: 409 }), 409);
  });

  it('añade la ruta a los errores desconocidos y responde 500 como el filtro base', () => {
    const { adapter, host, filter, logError, response } = setup();

    filter.catch(new Error('fallo inesperado'), host);

    expect(logError).toHaveBeenCalledWith('GET /api/v1/temas -> 500');
    expect(adapter.reply).toHaveBeenCalledWith(response, { statusCode: 500, message: 'Internal server error' }, 500);
  });
});
