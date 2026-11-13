import { ArgumentsHost, BadRequestException, Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';
import { LimitadorNoDisponibleException } from '../exceptions/limitador-no-disponible.exception.js';

/** Ruta sin query string: nunca se registran parámetros, cuerpo ni cabeceras. */
const requestPath = (request: Request): string => (request.originalUrl ?? request.url ?? '').split('?', 1)[0] ?? '';

/**
 * Registra los errores 5xx antes de delegar la respuesta en el filtro base de Nest.
 *
 * El filtro base no registra las HttpException (por ejemplo, el
 * ServiceUnavailableException con `cause` que generan los `handleDatabaseError`),
 * por lo que el error real de PostgreSQL se perdía. Solo se registran método,
 * ruta sin query string, estado, mensaje y la causa; nunca cuerpo, cabeceras ni
 * tokens. La respuesta al cliente no cambia.
 */
/**
 * Convierte los errores 4xx de middlewares de Express (p. ej. body-parser: 413 por exceder
 * API_BODY_LIMIT o 400 por JSON mal formado) en HttpException. El filtro base ya respondía con
 * su estado, pero los registraba como error desconocido: un cliente podía llenar los logs.
 */
function clientHttpError(exception: unknown): HttpException | undefined {
  if (!(exception instanceof Error) || exception instanceof HttpException) return undefined;
  const { status, statusCode, expose } = exception as Error & { status?: unknown; statusCode?: unknown; expose?: unknown };
  if (typeof statusCode !== 'number' || status !== statusCode || typeof expose !== 'boolean') return undefined;
  if (statusCode < 400 || statusCode >= 500) return undefined;
  const message = statusCode === 413 ? 'El cuerpo de la solicitud supera el tamaño permitido.' : exception.message;
  return new HttpException(message, statusCode);
}

/** Señales que deja Node en una solicitud cuyo cliente cerró la conexión antes de terminar el cuerpo. */
function requestAborted(request: Request): boolean {
  const state = request as Request & { aborted?: boolean; readableAborted?: boolean };
  return state.aborted === true || state.readableAborted === true || state.destroyed === true;
}

/**
 * Una carga multipart que el cliente interrumpe llega como `Error('Request aborted')` (multer,
 * evento `aborted` de la solicitud) o `MulterError` `STREAM_DESTROYED`. No es un fallo del
 * servidor: se responde 400 (el cliente ya no lo recibe) y se registra solo en debug, para que
 * nadie pueda generar alertas 5xx cortando sus propias subidas. Exige además que la solicitud
 * esté realmente abortada; cualquier otro error de multer o del almacenamiento sigue su curso.
 */
function clientAbortedUpload(exception: unknown, request: Request): HttpException | undefined {
  if (!(exception instanceof Error) || exception instanceof HttpException) return undefined;
  const code = (exception as Error & { code?: unknown }).code;
  const isAbort = (exception.message === 'Request aborted' && code === undefined) || (exception.name === 'MulterError' && code === 'STREAM_DESTROYED');
  if (!isAbort || !requestAborted(request)) return undefined;
  return new BadRequestException('La carga del archivo se interrumpió antes de completarse.');
}

@Catch()
export class ServerErrorLoggingFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('ServerError');

  override catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.getType() === 'http' ? host.switchToHttp().getRequest<Request>() : undefined;
    const aborted = http ? clientAbortedUpload(exception, http) : undefined;
    if (aborted && http) this.logger.debug(`${http.method} ${requestPath(http)}: carga interrumpida por el cliente.`);
    const normalized = aborted ?? clientHttpError(exception) ?? exception;
    if (http) this.logServerError(normalized, http);
    super.catch(normalized, host);
  }

  private logServerError(exception: unknown, request: Request): void {
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    if (status < 500) return;
    // Con Redis caído cada solicitud limitada responde 503; el limitador ya registra el fallo como
    // máximo una vez cada 30 s, así que aquí no se añade un error con stack por solicitud.
    if (exception instanceof LimitadorNoDisponibleException) return;
    const context = `${request.method} ${requestPath(request)} -> ${status}`;
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
