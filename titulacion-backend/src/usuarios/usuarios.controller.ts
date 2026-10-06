import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Roles } from '../common/roles.decorator.js';
import { Usuario } from './entities/usuario.entity.js';
import { CurrentUsuario } from './current-usuario.decorator.js';
import { CreateUsuarioDto } from './dto/create-usuario.dto.js';
import { ListUsuariosQueryDto } from './dto/list-usuarios-query.dto.js';
import { UsuarioResponseDto } from './dto/usuario-response.dto.js';
import { UsuarioRol } from './enums/usuario-rol.enum.js';
import { UsuariosService } from './usuarios.service.js';

@ApiTags('Usuarios')
@ApiExtraModels(UsuarioResponseDto)
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiForbiddenResponse({
  description: 'Cuenta inactiva o permisos insuficientes.',
})
@ApiServiceUnavailableResponse({
  description: 'No se pudo consultar o actualizar PostgreSQL.',
})
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuariosService: UsuariosService) {}

  @Post()
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Registrar una cuenta de usuario' })
  @ApiBadRequestResponse({ description: 'El cuerpo contiene datos inválidos.' })
  @ApiCreatedResponse({ type: UsuarioResponseDto })
  @ApiConflictResponse({
    description: 'El correo ya está registrado.',
  })
  create(@Body() dto: CreateUsuarioDto, @CurrentUsuario() actor: Usuario, @Req() request: Request): Promise<UsuarioResponseDto> {
    return this.usuariosService.create(dto, actor, request.ip ?? null);
  }

  @Post(':id/reenviar-acceso')
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Generar una nueva contraseña temporal para una cuenta pendiente de activar' })
  @ApiCreatedResponse({ type: UsuarioResponseDto })
  @ApiConflictResponse({ description: 'La cuenta ya estableció una contraseña personal.' })
  reissueAccess(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUsuario() actor: Usuario, @Req() request: Request): Promise<UsuarioResponseDto> {
    return this.usuariosService.reissueAccess(id, actor, request.ip ?? null);
  }

  @Get()
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Listar usuarios paginados' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    example: 1,
    minimum: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    example: 20,
    minimum: 1,
    maximum: 100,
  })
  @ApiBadRequestResponse({
    description: 'Los parámetros de paginación no son válidos.',
  })
  @ApiOkResponse({
    description: 'Página de usuarios ordenada por creación e identificador.',
    schema: {
      type: 'object',
      required: ['data', 'total', 'page', 'limit'],
      properties: {
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(UsuarioResponseDto) },
        },
        total: { type: 'integer' },
        page: { type: 'integer' },
        limit: { type: 'integer' },
      },
    },
  })
  list(@Query() query: ListUsuariosQueryDto) {
    return this.usuariosService.list(query);
  }

  @Get('me')
  @ApiOperation({ summary: 'Consultar la cuenta del usuario autenticado' })
  @ApiOkResponse({ type: UsuarioResponseDto })
  getCurrent(@CurrentUsuario() usuario: Usuario): Promise<UsuarioResponseDto> {
    return this.usuariosService.getCurrentProfile(usuario);
  }
}
