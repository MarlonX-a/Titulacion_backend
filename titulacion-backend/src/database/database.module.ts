import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { AppEnvironment } from '../config/environment.js';
import { DatabaseDataSource } from './database-data-source.js';
import { createDatabaseOptions } from './database.options.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnvironment, true>) => ({
        ...createDatabaseOptions({
          DB_HOST: config.get('DB_HOST', { infer: true }),
          DB_PORT: config.get('DB_PORT', { infer: true }),
          DB_USERNAME: config.get('DB_USERNAME', { infer: true }),
          DB_PASSWORD: config.get('DB_PASSWORD', { infer: true }),
          DB_NAME: config.get('DB_NAME', { infer: true }),
        }),
        retryAttempts: 3,
        retryDelay: 1000,
      }),
      dataSourceFactory: async (options) => {
        if (!options) {
          throw new Error('Falta la configuración de PostgreSQL.');
        }

        return new DatabaseDataSource(options);
      },
    }),
  ],
})
export class DatabaseModule {}
