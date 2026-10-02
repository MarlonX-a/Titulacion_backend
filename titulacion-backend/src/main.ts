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
  if (config.get('AUTH_MODE', { infer: true }) === 'local') {
    await app.listen(port, '127.0.0.1');
  } else {
    await app.listen(port);
  }
}
await bootstrap();
