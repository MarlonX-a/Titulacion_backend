import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  CurrentIdentity,
  type AuthenticatedIdentity,
} from './authenticated-identity.js';
import { AllowUnregisteredIdentity } from './allow-unregistered-identity.decorator.js';

@ApiTags('Autenticación')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  @Get('me')
  @AllowUnregisteredIdentity()
  @ApiOperation({ summary: 'Consultar la identidad del token autenticado' })
  @ApiOkResponse({
    description: 'Identidad verificada por el proveedor configurado.',
    schema: {
      type: 'object',
      required: ['subject', 'issuer'],
      properties: {
        subject: { type: 'string', example: 'identificador-institucional' },
        issuer: { type: 'string', example: 'https://identidad.ejemplo.edu' },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
  @ApiServiceUnavailableResponse({
    description:
      'Autenticación no configurada o claves temporalmente inaccesibles.',
  })
  getIdentity(
    @CurrentIdentity() identity: AuthenticatedIdentity,
  ): AuthenticatedIdentity {
    return identity;
  }
}
