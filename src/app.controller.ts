import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service.js';
import { Public } from './auth/public.decorator.js';

@ApiTags('Sistema')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Consultar el saludo de la aplicación' })
  @ApiOkResponse({
    description: 'Respuesta inicial del backend.',
    content: {
      'text/html': { schema: { type: 'string', example: 'Hello World!' } },
    },
  })
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('healthz')
  @Public()
  @ApiOperation({ summary: 'Comprobar que el proceso responde (sin detalles de dependencias)' })
  @ApiOkResponse({ description: 'El proceso está en ejecución.', schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' } } } })
  healthz(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
