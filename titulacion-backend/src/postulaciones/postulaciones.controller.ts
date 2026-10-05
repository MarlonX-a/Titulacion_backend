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
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { PagedPostulacionesResponseDto, PostulacionResponseDto } from './dto/postulacion-response.dto.js';
import { PostulacionesService } from './postulaciones.service.js';
import { TutoresPropuestosService } from './tutores-propuestos.service.js';
import { TutoresPropuestosInputDto, PagedTutorsResponseDto, TutorPropuestoResponseDto } from './dto/tutores-propuestos.dto.js';

@ApiTags('Postulaciones')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no está disponible.' })
@Controller('periodos/:periodoId/postulaciones')
export class PostulacionesController {
  constructor(private readonly postulaciones: PostulacionesService, private readonly tutores: TutoresPropuestosService) {}

  @Post()
  @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Registrar postulación individual o grupal durante el plazo' })
  @ApiCreatedResponse({ type: PostulacionResponseDto })
  @ApiBadRequestResponse({ description: 'UUID, modalidad, lista de tutores o propiedades inválidas.' })
  @ApiForbiddenResponse({ description: 'Estudiante no habilitado o no representante del grupo.' })
  @ApiNotFoundResponse({ description: 'Período o tema inexistente.' })
  @ApiConflictResponse({ description: 'Plazo, tema, rango, pertenencia o postulación activa incompatible.' })
  create(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Body() dto: CreatePostulacionDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.postulaciones.create(periodoId, actor, dto, request.ip ?? null);
  }

  @Post(':id/tutores-propuestos')
  @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Completar una sola vez las preferencias de una postulación antigua' })
  @ApiCreatedResponse({ type: TutorPropuestoResponseDto, isArray: true, description: 'Preferencias registradas. La respuesta contiene la lista completa.' })
  @ApiBadRequestResponse({ description: 'Lista vacía, UUID inválido o docentes repetidos.' })
  @ApiForbiddenResponse({ description: 'Solo el titular o representante actual puede completar la lista.' })
  @ApiNotFoundResponse({ description: 'La postulación no existe o no es visible.' })
  @ApiConflictResponse({ description: 'La postulación ya tiene tutores o no está dentro del plazo.' })
  async completeTutors(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: TutoresPropuestosInputDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    await this.postulaciones.completarTutores(periodoId, id, actor, dto.tutores_propuestos, request.ip ?? null);
    return this.tutores.listarTodasDePostulacion(periodoId, id);
  }

  @Get(':id/tutores-propuestos')
  @Roles(UsuarioRol.ADMIN, UsuarioRol.DOCENTE, UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Consultar preferencias ordenadas con elegibilidad actual de cada docente' })
  @ApiOkResponse({ type: PagedTutorsResponseDto })
  async listTutors(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @Query() query: PaginationQueryDto, @CurrentUsuario() actor: Usuario) {
    await this.postulaciones.getById(periodoId, id, actor, actor.rol === UsuarioRol.ADMIN);
    return this.tutores.listarDePostulacion(periodoId, id, query.page, query.limit);
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
