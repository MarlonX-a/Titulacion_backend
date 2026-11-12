import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module.js';
import type { AppEnvironment } from './config/environment.js';
import { configureApplication } from './config/setup-app.js';
import { checkPendingMigrations } from './database/pending-migrations.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks();
  const config = app.get(ConfigService<AppEnvironment, true>);
  // Solo se confía en X-Forwarded-For de los proxies indicados en TRUST_PROXY;
  // así request.ip refleja al cliente real para límites de acceso y auditoría.
  app.set('trust proxy', config.get('TRUST_PROXY', { infer: true }));
  app.disable('x-powered-by');
  configureApplication(app);

  const nodeEnv = config.get('NODE_ENV', { infer: true });
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
await bootstrap();
