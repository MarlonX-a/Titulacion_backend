import { Body, Controller, Header, HttpCode, Ip, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { Public } from '../public.decorator.js';
import { LocalLoginDto } from './local-login.dto.js';
import {
  LocalAuthenticationService,
  type LocalLoginResult,
} from './local-authentication.service.js';

@ApiTags('Autenticación local de pruebas')
@Controller('auth/local')
export class LocalAuthController {
  constructor(private readonly localAuthentication: LocalAuthenticationService) {}

  @Post('login')
  @Public()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Iniciar sesión con una cuenta local de pruebas',
    description:
      'Disponible únicamente cuando AUTH_MODE=local en desarrollo o pruebas.',
  })
  @ApiOkResponse({
    description: 'Token Bearer local válido durante 15 minutos.',
    schema: {
      type: 'object',
      required: ['access_token', 'token_type', 'expires_in'],
      properties: {
        access_token: { type: 'string' },
        token_type: { type: 'string', example: 'Bearer' },
        expires_in: { type: 'integer', example: 900 },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Correo o contraseña mal formados.' })
  @ApiUnauthorizedResponse({ description: 'Credenciales incorrectas.' })
  @ApiForbiddenResponse({ description: 'La cuenta de pruebas no está activa.' })
  @ApiServiceUnavailableResponse({
    description: 'No se pudo consultar la base de datos local.',
  })
  @ApiTooManyRequestsResponse({ description: 'Límite de intentos alcanzado.' })
  @ApiNotFoundResponse({ description: 'El acceso local no está habilitado.' })
  login(
    @Body() input: LocalLoginDto,
    @Ip() clientAddress: string,
  ): Promise<LocalLoginResult> {
    return this.localAuthentication.login(input, clientAddress);
  }
}
