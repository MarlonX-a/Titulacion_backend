import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiExtraModels, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse, getSchemaPath } from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../common/roles.decorator.js';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CreateTemaDto } from './dto/create-tema.dto.js';
import { ListTemasQueryDto } from './dto/list-temas-query.dto.js';
import { TemaHistorialResponseDto } from './dto/tema-historial-response.dto.js';
import { TemaResponseDto } from './dto/tema-response.dto.js';
import { UpdateTemaDto } from './dto/update-tema.dto.js';
import { PublicarTemaDto } from './dto/publicar-tema.dto.js';
import { TemasService } from './temas.service.js';

@ApiTags('Temas de titulación')
@ApiBearerAuth('bearer')
@ApiExtraModels(TemaResponseDto, TemaHistorialResponseDto)
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no está disponible.' })
@Controller('periodos/:periodoId/temas')
export class TemasController {
  constructor(private readonly temas: TemasService) {}

  @Post()
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Registrar un tema en borrador' })
  @ApiCreatedResponse({ type: TemaResponseDto })
  @ApiBadRequestResponse({ description: 'Datos inválidos o límites incompatibles.' })
  @ApiForbiddenResponse({ description: 'Se requiere una cuenta ADMIN activa.' })
  @ApiNotFoundResponse({ description: 'No existe el período, línea o docente indicado.' })
  @ApiConflictResponse({ description: 'El período no está en BORRADOR o una referencia está inactiva.' })
  create(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Body() dto: CreateTemaDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.temas.create(periodoId, dto, actor, request.ip || null);
  }

  @Post(':id/publicar')
  @HttpCode(HttpStatus.OK)
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Publicar un tema en borrador' })
  @ApiOkResponse({ type: TemaResponseDto })
  @ApiBadRequestResponse({ description: 'El cuerpo debe estar vacío o los datos del tema son inválidos.' })
  @ApiForbiddenResponse({ description: 'Se requiere una cuenta ADMIN activa.' })
  @ApiNotFoundResponse({ description: 'No existe el período o tema indicado.' })
  @ApiConflictResponse({ description: 'El período está fuera de plazo, el tema no está en BORRADOR o una referencia no está activa.' })
  publish(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: PublicarTemaDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.temas.publish(periodoId, id, dto, actor, request.ip || null);
  }

  @Get()
  @Roles(UsuarioRol.ADMIN, UsuarioRol.DOCENTE, UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Listar temas del período' })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'linea_id', required: false, type: String })
  @ApiQuery({ name: 'docente_proponente_id', required: false, type: String })
  @ApiQuery({ name: 'estado', required: false, enum: ['BORRADOR', 'PUBLICADO', 'CERRADO', 'ASIGNADO', 'RETIRADO'] })
  @ApiQuery({ name: 'num_integrantes', required: false, type: Number, minimum: 1, maximum: 32767 })
  @ApiOkResponse({ schema: { type: 'object', required: ['data', 'total', 'page', 'limit'], properties: { data: { type: 'array', items: { $ref: getSchemaPath(TemaResponseDto) } }, total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' } } } })
  @ApiForbiddenResponse({ description: 'El rol, período o habilitación no permite consultar estos temas.' })
  list(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Query() query: ListTemasQueryDto, @CurrentUsuario() actor: Usuario) {
    return this.temas.list(periodoId, query, actor);
  }

  @Get(':id/historial')
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Consultar el historial de un tema' })
  @ApiOkResponse({ schema: { type: 'object', required: ['data', 'total', 'page', 'limit'], properties: { data: { type: 'array', items: { $ref: getSchemaPath(TemaHistorialResponseDto) } }, total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' } } } })
  @ApiNotFoundResponse({ description: 'No existe el tema en el período indicado.' })
  history(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @Query() query: ListTemasQueryDto) {
    return this.temas.history(periodoId, id, query);
  }

  @Get(':id')
  @Roles(UsuarioRol.ADMIN, UsuarioRol.DOCENTE, UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Consultar el detalle de un tema' })
  @ApiOkResponse({ type: TemaResponseDto })
  @ApiNotFoundResponse({ description: 'No existe el tema o no pertenece al docente autenticado.' })
  getById(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @CurrentUsuario() actor: Usuario) {
    return this.temas.getById(periodoId, id, actor);
  }

  @Patch(':id')
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Editar un tema en borrador' })
  @ApiOkResponse({ type: TemaResponseDto })
  @ApiBadRequestResponse({ description: 'Cuerpo vacío, datos inválidos o límites incompatibles.' })
  @ApiNotFoundResponse({ description: 'No existe el tema en el período indicado.' })
  @ApiConflictResponse({ description: 'El período o tema no está en BORRADOR, o una referencia está inactiva.' })
  update(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateTemaDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.temas.update(periodoId, id, dto, actor, request.ip || null);
  }
}
