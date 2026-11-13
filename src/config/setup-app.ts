import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { ServerErrorLoggingFilter } from '../common/filters/server-error-logging.filter.js';
import type { AppEnvironment } from './environment.js';

/** Tamaño máximo de un cuerpo JSON o urlencoded. Las subidas multipart tienen sus propios límites. */
export const API_BODY_LIMIT = '100kb';

/**
 * Cabeceras comunes a toda respuesta de la API, incluidas 401/403/404/429: nada se guarda en
 * cachés (equipos compartidos de laboratorio) y el navegador no reinterpreta el tipo de contenido.
 */
export function securityHeaders(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

export function configureApplication(app: INestApplication): void {
  // Middleware de Express registrado antes que las rutas de Nest: cubre también errores y 404.
  app.use(securityHeaders);
  const express = app as NestExpressApplication;
  // Reemplazan a los analizadores predeterminados de Nest (mismo nombre de middleware).
  express.useBodyParser('json', { limit: API_BODY_LIMIT });
  express.useBodyParser('urlencoded', { limit: API_BODY_LIMIT, extended: true });
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

  // Solo con SWAGGER_ENABLED=true explícito (el valor predeterminado es false en todo entorno).
  if (config.get('SWAGGER_ENABLED', { infer: true }) === true) {
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
