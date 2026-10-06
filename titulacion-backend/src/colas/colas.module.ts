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
      },
    }),
  })],
  exports: [BullModule],
})
export class ColasModule {}
