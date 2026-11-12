import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';

/**
 * Registra los errores 5xx antes de delegar la respuesta en el filtro base de Nest.
 *
 * El filtro base no registra las HttpException (por ejemplo, el
 * ServiceUnavailableException con `cause` que generan los `handleDatabaseError`),
 * por lo que el error real de PostgreSQL se perdía. Solo se registran método,
 * ruta sin query string, estado, mensaje y la causa; nunca cuerpo, cabeceras ni
 * tokens. La respuesta al cliente no cambia.
 */
@Catch()
export class ServerErrorLoggingFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('ServerError');

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() === 'http') this.logServerError(exception, host.switchToHttp().getRequest<Request>());
    super.catch(exception, host);
  }

  private logServerError(exception: unknown, request: Request): void {
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    if (status < 500) return;
    const path = (request.originalUrl ?? request.url ?? '').split('?', 1)[0];
    const context = `${request.method} ${path} -> ${status}`;
    if (!(exception instanceof HttpException)) {
      // El filtro base ya registra el error desconocido con su stack; aquí solo se añade la ruta.
      this.logger.error(context);
      return;
    }
    const cause = exception.cause;
    if (cause instanceof Error) {
      this.logger.error(`${context}: ${exception.message}. Causa: ${cause.message}`, cause.stack);
    } else if (cause !== undefined) {
      this.logger.error(`${context}: ${exception.message}. Causa: ${String(cause)}`);
    } else {
      this.logger.error(`${context}: ${exception.message}`, exception.stack);
    }
  }
}
