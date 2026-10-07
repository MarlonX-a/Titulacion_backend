import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment.js';

@Global()
@Module({
  imports: [BullModule.forRootAsync({
    inject: [ConfigService],
    useFactory: (config: ConfigService<AppEnvironment, true>) => ({
      connection: {
        host: config.get('REDIS_HOST', { infer: true }) ?? '127.0.0.1',
        port: config.get('REDIS_PORT', { infer: true }),
        maxRetriesPerRequest: null,
        connectTimeout: 5_000,
        // BullMQ debe poder recuperarse si Redis se reinicia, pero el reintento
        // predeterminado cada pocos segundos llena la consola cuando no existe.
        retryStrategy: (attempt: number) => Math.min(500 * 2 ** Math.min(attempt - 1, 6), 30_000),
      },
    }),
  })],
  exports: [BullModule],
})
export class ColasModule {}
