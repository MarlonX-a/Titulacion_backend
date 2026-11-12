import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ServerErrorLoggingFilter } from '../common/filters/server-error-logging.filter.js';
import type { AppEnvironment } from './environment.js';

export function configureApplication(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      validationError: { target: false, value: false },
    }),
  );
  app.useGlobalFilters(new ServerErrorLoggingFilter(app.get(HttpAdapterHost).httpAdapter));

  const config = app.get(ConfigService<AppEnvironment, true>);

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    const options = new DocumentBuilder()
      .setTitle('Sistema de Gestión del Proceso de Titulación')
      .setDescription(
        'API REST del Sistema de Gestión del Proceso de Titulación.',
      )
      .setVersion('0.0.1')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'bearer',
      )
      .build();

    const document = SwaggerModule.createDocument(app, options);
    SwaggerModule.setup('docs', app, document, {
      jsonDocumentUrl: '/docs-json',
      raw: ['json'],
      swaggerOptions: { withCredentials: true },
    });
  }
}
