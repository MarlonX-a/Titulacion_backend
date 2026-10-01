import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service.js';

@ApiTags('Sistema')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
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
}
