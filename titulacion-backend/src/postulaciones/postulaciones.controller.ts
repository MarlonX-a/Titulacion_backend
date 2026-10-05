import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { Roles } from '../common/roles.decorator.js';
import { CancelarPostulacionDto } from './dto/cancelar-postulacion.dto.js';
import { CreatePostulacionDto } from './dto/create-postulacion.dto.js';
import { ListPostulacionesQueryDto } from './dto/list-postulaciones-query.dto.js';
import { PagedPostulacionesResponseDto, PostulacionResponseDto } from './dto/postulacion-response.dto.js';
import { PostulacionesService } from './postulaciones.service.js';

@ApiTags('Postulaciones')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no está disponible.' })
@Controller('periodos/:periodoId/postulaciones')
export class PostulacionesController {
  constructor(private readonly postulaciones: PostulacionesService) {}

  @Post()
  @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Registrar postulación individual o grupal durante el plazo' })
  @ApiCreatedResponse({ type: PostulacionResponseDto })
  @ApiBadRequestResponse({ description: 'UUID, modalidad o propiedades inválidas.' })
  @ApiForbiddenResponse({ description: 'Estudiante no habilitado o no representante del grupo.' })
  @ApiNotFoundResponse({ description: 'Período o tema inexistente.' })
  @ApiConflictResponse({ description: 'Plazo, tema, rango, pertenencia o postulación activa incompatible.' })
  create(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Body() dto: CreatePostulacionDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.postulaciones.create(periodoId, actor, dto, request.ip ?? null);
  }

  @Get()
  @Roles(UsuarioRol.ADMIN, UsuarioRol.DOCENTE)
  @ApiOperation({ summary: 'Consultar postulaciones del período (DOCENTE solo ve las de sus temas)' })
  @ApiOkResponse({ type: PagedPostulacionesResponseDto })
  list(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Query() query: ListPostulacionesQueryDto, @CurrentUsuario() actor: Usuario) {
    return this.postulaciones.list(periodoId, query, actor, actor.rol === UsuarioRol.ADMIN);
  }

  @Get('me')
  @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Consultar postulaciones individuales y de su grupo actual' })
  @ApiOkResponse({ type: PagedPostulacionesResponseDto })
  getMine(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Query() query: ListPostulacionesQueryDto, @CurrentUsuario() actor: Usuario) {
    return this.postulaciones.listMine(periodoId, actor, query);
  }

  @Get(':id')
  @Roles(UsuarioRol.ADMIN, UsuarioRol.DOCENTE, UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Consultar detalle con permiso de recurso' })
  @ApiOkResponse({ type: PostulacionResponseDto })
  @ApiForbiddenResponse({ description: 'El rol no puede consultar postulaciones.' })
  @ApiNotFoundResponse({ description: 'La postulación no existe o no es visible para el usuario.' })
  getById(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @CurrentUsuario() actor: Usuario) {
    return this.postulaciones.getById(periodoId, id, actor, actor.rol === UsuarioRol.ADMIN);
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @Roles(UsuarioRol.ADMIN, UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Cancelar una postulación pendiente conservando su historial' })
  @ApiOkResponse({ type: PostulacionResponseDto })
  @ApiBadRequestResponse({ description: 'Motivo vacío, demasiado largo o campos adicionales.' })
  @ApiForbiddenResponse({ description: 'No se permite cancelar en este momento.' })
  @ApiNotFoundResponse({ description: 'La postulación no existe o no es visible para el usuario.' })
  @ApiConflictResponse({ description: 'Estado o plazo incompatible.' })
  cancel(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: CancelarPostulacionDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.postulaciones.cancel(periodoId, id, actor, actor.rol === UsuarioRol.ADMIN, dto, request.ip ?? null);
  }
}
