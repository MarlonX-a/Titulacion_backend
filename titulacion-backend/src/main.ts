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
  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
