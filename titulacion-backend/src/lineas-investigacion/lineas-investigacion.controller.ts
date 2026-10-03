import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiExtraModels,
  ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiQuery,
  ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse, getSchemaPath,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../common/roles.decorator.js';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CreateLineaInvestigacionDto } from './dto/create-linea-investigacion.dto.js';
import { LineaInvestigacionResponseDto } from './dto/linea-investigacion-response.dto.js';
import { ListLineasQueryDto } from './dto/list-lineas-query.dto.js';
import { UpdateLineaInvestigacionDto } from './dto/update-linea-investigacion.dto.js';
import { LineasInvestigacionService } from './lineas-investigacion.service.js';

@ApiTags('Líneas de investigación')
@ApiBearerAuth('bearer')
@ApiExtraModels(LineaInvestigacionResponseDto)
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no está disponible.' })
@Controller('lineas-investigacion')
export class LineasInvestigacionController {
  constructor(private readonly lineas: LineasInvestigacionService) {}

  @Post()
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Crear una línea activa (ADMIN)' })
  @ApiCreatedResponse({ type: LineaInvestigacionResponseDto })
  @ApiBadRequestResponse({ description: 'Código, nombre o descripción inválidos.' })
  @ApiForbiddenResponse({ description: 'Se requiere ADMIN activo.' })
  @ApiConflictResponse({ description: 'El código ya está registrado.' })
  create(@Body() dto: CreateLineaInvestigacionDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.lineas.create(dto, actor, request.ip || null);
  }

  @Get()
  @Roles(UsuarioRol.ADMIN, UsuarioRol.DOCENTE, UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Listar líneas de investigación paginadas' })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'activa', required: false, enum: ['true', 'false'], description: 'ADMIN puede filtrar el estado; otros roles solo pueden consultar activas.' })
  @ApiOkResponse({ schema: {
    type: 'object', required: ['data', 'total', 'page', 'limit'], properties: {
      data: { type: 'array', items: { $ref: getSchemaPath(LineaInvestigacionResponseDto) } },
      total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' },
    },
  } })
  @ApiForbiddenResponse({ description: 'Solo ADMIN puede solicitar líneas inactivas.' })
  list(@Query() query: ListLineasQueryDto, @CurrentUsuario() actor: Usuario) {
    return this.lineas.list(query, actor.rol);
  }

  @Get(':id')
  @Roles(UsuarioRol.ADMIN, UsuarioRol.DOCENTE, UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Consultar una línea por UUID' })
  @ApiOkResponse({ type: LineaInvestigacionResponseDto })
  @ApiBadRequestResponse({ description: 'El identificador debe ser un UUID válido.' })
  @ApiNotFoundResponse({ description: 'La línea no existe o está inactiva para este rol.' })
  getById(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUsuario() actor: Usuario) {
    return this.lineas.getById(id, actor.rol);
  }

  @Patch(':id')
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Editar, desactivar o reactivar una línea (ADMIN)' })
  @ApiOkResponse({ type: LineaInvestigacionResponseDto })
  @ApiBadRequestResponse({ description: 'Cuerpo vacío o datos inválidos.' })
  @ApiForbiddenResponse({ description: 'Se requiere ADMIN activo.' })
  @ApiNotFoundResponse({ description: 'No existe la línea solicitada.' })
  @ApiConflictResponse({ description: 'El código ya está registrado.' })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateLineaInvestigacionDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.lineas.update(id, dto, actor, request.ip || null);
  }
}
