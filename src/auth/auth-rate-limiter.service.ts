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

  async enforce(key: string, limit: number, windowSeconds: number): Promise<void> {
    if (this.isTest) return;
    try {
      if (this.redis.status === 'wait') await this.redis.connect();
      const count = Number(await this.redis.eval(
        "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return count",
        1,
        `titulacion:auth-rate:${key}`,
        String(windowSeconds),
      ));
      if (count > limit) throw new HttpException('Se alcanzó el límite de solicitudes. Inténtalo más tarde.', HttpStatus.TOO_MANY_REQUESTS);
    } catch (error: unknown) {
      if (error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS) throw error;
      throw new ServiceUnavailableException('El servicio de autenticación no está disponible.');
    }
  }

  async onModuleDestroy(): Promise<void> { await this.redis.quit().catch(() => undefined); }
}
