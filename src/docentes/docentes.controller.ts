import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Roles } from '../common/roles.decorator.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CreateDocenteDto } from './dto/create-docente.dto.js';
import { UpdateDocenteDto } from './dto/update-docente.dto.js';
import { DocenteResponseDto } from './dto/docente-response.dto.js';
import { DocentesService } from './docentes.service.js';

@ApiTags('Docentes')
@ApiExtraModels(DocenteResponseDto)
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiForbiddenResponse({ description: 'La cuenta no tiene el rol requerido.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no está disponible.' })
@Controller('docentes')
export class DocentesController {
  constructor(private readonly docentes: DocentesService) {}

  @Post()
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({
    summary: 'Registrar un docente',
    description:
      'Con usuario_id crea el perfil para una cuenta DOCENTE existente. Sin usuario_id crea, en una sola transacción, la cuenta DOCENTE (clave temporal y correo de acceso asíncrono) y su perfil.',
  })
  @ApiBadRequestResponse({ description: 'Los campos no son válidos o mezclan usuario_id con datos de cuenta.' })
  @ApiCreatedResponse({ type: DocenteResponseDto })
  @ApiConflictResponse({ description: 'Cuenta incompatible, correo o cédula duplicados, o perfil duplicado.' })
  @ApiNotFoundResponse({ description: 'La cuenta indicada no existe.' })
  create(
    @Body() dto: CreateDocenteDto,
    @CurrentUsuario() actor: Usuario,
    @Req() request: Request,
  ): Promise<DocenteResponseDto> {
    return this.docentes.create(dto, actor, request.ip ?? null);
  }

  @Get()
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Listar perfiles de docentes paginados' })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
  })
  @ApiBadRequestResponse({ description: 'La paginación no es válida.' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['data', 'total', 'page', 'limit'],
      properties: {
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(DocenteResponseDto) },
        },
        total: { type: 'integer' },
        page: { type: 'integer' },
        limit: { type: 'integer' },
      },
    },
  })
  list(@Query() query: PaginationQueryDto) {
    return this.docentes.list(query);
  }

  @Get('me')
  @Roles(UsuarioRol.DOCENTE)
  @ApiOperation({ summary: 'Consultar el perfil docente propio' })
  @ApiOkResponse({ type: DocenteResponseDto })
  @ApiNotFoundResponse({ description: 'La cuenta aún no tiene perfil.' })
  getCurrent(@CurrentUsuario() usuario: Usuario): Promise<DocenteResponseDto> {
    return this.docentes.getByUsuarioId(usuario.id);
  }

  @Get(':id')
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Consultar un perfil docente' })
  @ApiOkResponse({ type: DocenteResponseDto })
  @ApiBadRequestResponse({ description: 'El identificador no es un UUID válido.' })
  @ApiNotFoundResponse({ description: 'No existe el perfil solicitado.' })
  getById(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DocenteResponseDto> {
    return this.docentes.getById(id);
  }

  @Patch(':id')
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({
    summary: 'Editar un docente',
    description:
      'Edita nombres, apellidos y estado (ACTIVO/INACTIVO) de la cuenta, y cédula, título, departamento y habilitación para tutoría del perfil. El correo no es editable. INACTIVO revoca las sesiones vigentes y no altera tutorías ni asignaciones existentes.',
  })
  @ApiOkResponse({ type: DocenteResponseDto })
  @ApiBadRequestResponse({ description: 'Cuerpo vacío, campos inválidos o intento de cambiar el correo.' })
  @ApiNotFoundResponse({ description: 'No existe el perfil solicitado.' })
  @ApiConflictResponse({ description: 'La cédula ya está registrada en otro docente.' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateDocenteDto,
    @CurrentUsuario() actor: Usuario,
    @Req() request: Request,
  ): Promise<DocenteResponseDto> {
    return this.docentes.update(id, dto, actor, request.ip ?? null);
  }
}
