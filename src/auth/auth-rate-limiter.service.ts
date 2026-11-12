import { HttpException, HttpStatus, Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { AppEnvironment } from '../config/environment.js';

@Injectable()
export class AuthRateLimiterService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly isTest: boolean;

  constructor(config: ConfigService<AppEnvironment, true>) {
    this.isTest = config.get('NODE_ENV', { infer: true }) === 'test';
    this.redis = new Redis({
      host: config.get('REDIS_HOST', { infer: true }) ?? '127.0.0.1',
      port: config.get('REDIS_PORT', { infer: true }),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 5_000,
      retryStrategy: (attempt: number) => Math.min(500 * 2 ** Math.min(attempt - 1, 6), 30_000),
    });
    this.redis.on('error', () => undefined);
  }

  /** Cuenta la solicitud actual y rechaza cuando el contador supera el límite de la ventana. */
  async enforce(key: string, limit: number, windowSeconds: number): Promise<void> {
    if (this.isTest) return;
    await this.guard(async () => {
      if ((await this.increment(key, windowSeconds)) > limit) throw tooManyRequests();
    });
  }

  /** Rechaza si el contador ya alcanzó el límite, sin contar la solicitud actual. */
  async assertBelow(key: string, limit: number): Promise<void> {
    if (this.isTest) return;
    await this.guard(async () => {
      await this.connect();
      if (Number(await this.redis.get(redisKey(key)) ?? 0) >= limit) throw tooManyRequests();
    });
  }

  /** Suma un evento (por ejemplo, un intento fallido) al contador de la ventana. */
  async hit(key: string, windowSeconds: number): Promise<void> {
    if (this.isTest) return;
    await this.guard(async () => { await this.increment(key, windowSeconds); });
  }

  private async increment(key: string, windowSeconds: number): Promise<number> {
    await this.connect();
    return Number(await this.redis.eval(
      "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return count",
      1,
      redisKey(key),
      String(windowSeconds),
    ));
  }

  private async connect(): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect();
  }

  private async guard(operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (error: unknown) {
      if (error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS) throw error;
      throw new ServiceUnavailableException('El servicio de autenticación no está disponible.');
    }
  }

  async onModuleDestroy(): Promise<void> { await this.redis.quit().catch(() => undefined); }
}

function redisKey(key: string): string {
  return `titulacion:auth-rate:${key}`;
}

function tooManyRequests(): HttpException {
  return new HttpException('Se alcanzó el límite de solicitudes. Inténtalo más tarde.', HttpStatus.TOO_MANY_REQUESTS);
}
