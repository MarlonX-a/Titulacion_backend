import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module.js';
import { assertRuntimeEnvironment, type AppEnvironment } from './config/environment.js';
import { configureApplication } from './config/setup-app.js';
import { checkPendingMigrations } from './database/pending-migrations.js';

async function bootstrap() {
  // NODE_ENV=test no es un modo de ejecución: se rechaza antes de abrir conexiones o puertos.
  assertRuntimeEnvironment(process.env.NODE_ENV);
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService<AppEnvironment, true>);
  const nodeEnv = config.get('NODE_ENV', { infer: true });
  try {
    // El valor efectivo también puede venir de .env.
    assertRuntimeEnvironment(nodeEnv);
  } catch (error: unknown) {
    await app.close();
    throw error;
  }
  app.enableShutdownHooks();
  // Solo se confía en X-Forwarded-For de los proxies indicados en TRUST_PROXY;
  // así request.ip refleja al cliente real para límites de acceso y auditoría.
  app.set('trust proxy', config.get('TRUST_PROXY', { infer: true }));
  app.disable('x-powered-by');
  configureApplication(app);

  await checkPendingMigrations(app.get(DataSource), nodeEnv);

  const port = config.get('PORT', { infer: true });
  const origins = config.get('AUTH_ORIGINS', { infer: true });
  if (origins.length > 0) {
    app.enableCors({ origin: origins, credentials: true, allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'], methods: ['GET', 'POST', 'PATCH', 'OPTIONS'] });
  }
  if (nodeEnv !== 'production') {
    await app.listen(port, '127.0.0.1');
  } else {
    await app.listen(port);
  }
}

try {
  await bootstrap();
} catch (error: unknown) {
  if (error instanceof Error) new Logger('Bootstrap').error(error.message, error.stack);
  else new Logger('Bootstrap').error('No se pudo iniciar la aplicación.');
  process.exit(1);
}
