import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AuthRateLimiterService } from '../../auth/auth-rate-limiter.service.js';
import type { AuthenticatedIdentity } from '../../auth/authenticated-identity.js';
import type { Usuario } from '../../usuarios/entities/usuario.entity.js';
import { LIMITE_GLOBAL_IP, LIMITE_GLOBAL_USUARIO, RATE_LIMIT, type RateLimitOptions } from './rate-limit.decorator.js';

type RateLimitedRequest = Request & { user?: AuthenticatedIdentity; usuario?: Usuario };

/**
 * Guard global registrado después de `AuthenticationGuard`, por lo que ya conoce al usuario.
 * Aplica `@RateLimit` o, si la ruta no lo declara, el límite global. Al exceder responde 429.
 * Si Redis no responde, el límite global deja pasar la solicitud y `@RateLimit` responde 503.
 * Con `concurrencia`, además toma un cupo de solicitudes simultáneas por sujeto (429 si no hay).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: AuthRateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<RateLimitedRequest>();
    const declared = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    const usuarioId = request.usuario?.id ?? request.user?.subject;
    const porUsuario = usuarioId !== undefined && usuarioId.length > 0 && (declared?.por ?? 'usuario') === 'usuario';
    const options = declared ?? (porUsuario ? LIMITE_GLOBAL_USUARIO : LIMITE_GLOBAL_IP);
    const sujeto = porUsuario ? usuarioId : clientIp(request);
    // El límite global antiabuso falla abierto: sin Redis la API (y /healthz) sigue respondiendo.
    // Un @RateLimit explícito protege una operación concreta y falla cerrado (503).
    await this.limiter.enforce(`rl:${options.clave}:${sujeto}`, options.limite, options.ventanaSegundos, {
      siRedisFalla: declared ? 'rechazar' : 'permitir',
    });
    if (declared?.concurrencia) await this.tomarCupoConcurrente(context, `rl:${declared.clave}:concurrentes:${sujeto}`, declared.concurrencia);
    return true;
  }

  /**
   * Toma un cupo de solicitudes simultáneas y lo devuelve cuando la respuesta termina o la
   * conexión se cierra (incluida una subida abortada). `reserve` falla cerrado (503) sin Redis.
   */
  private async tomarCupoConcurrente(context: ExecutionContext, clave: string, concurrencia: { limite: number; ttlSegundos: number }): Promise<void> {
    if (!(await this.limiter.reserve(clave, concurrencia.limite, concurrencia.ttlSegundos))) {
      throw new HttpException('Ya tienes una subida en curso. Espera a que termine e inténtalo de nuevo.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const response = context.switchToHttp().getResponse<Response>();
    let liberado = false;
    const liberar = (): void => {
      if (liberado) return;
      liberado = true;
      this.limiter.release(clave).catch(() => {
        this.logger.warn('No se pudo liberar un cupo de subida simultánea; vencerá por sí solo.');
      });
    };
    response.once('finish', liberar);
    response.once('close', liberar);
    if (response.writableFinished || response.destroyed) liberar();
  }
}

/** IP resuelta por Express según TRUST_PROXY; nunca se lee X-Forwarded-For directamente. */
function clientIp(request: Request): string {
  return request.ip ?? request.socket?.remoteAddress ?? 'desconocida';
}
