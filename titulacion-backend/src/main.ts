import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import type { AppEnvironment } from './config/environment.js';
import { configureApplication } from './config/setup-app.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  configureApplication(app);

  const config = app.get(ConfigService<AppEnvironment, true>);
  const port = config.get('PORT', { infer: true });
  const origins = config.get('AUTH_ORIGINS', { infer: true });
  if (origins.length > 0) {
    app.enableCors({ origin: origins, credentials: true, allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'], methods: ['GET', 'POST', 'PATCH', 'OPTIONS'] });
  }
  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    await app.listen(port, '127.0.0.1');
  } else {
    await app.listen(port);
  }
}
await bootstrap();
