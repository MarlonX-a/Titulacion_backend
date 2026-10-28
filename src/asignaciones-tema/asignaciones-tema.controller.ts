import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../common/roles.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { AnularAsignacionTemaDto } from './dto/anular-asignacion-tema.dto.js';
import { AsignarTemaDto } from './dto/asignar-tema.dto.js';
import { ListAsignacionesTemaQueryDto } from './dto/list-asignaciones-tema-query.dto.js';
import { AsignacionTemaResponseDto, PagedAsignacionesTemaResponseDto } from './dto/asignacion-tema-response.dto.js';
import { AsignacionesTemaService } from './asignaciones-tema.service.js';

@ApiTags('Asignaciones de tema')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no está disponible.' })
@Controller('periodos/:periodoId')
export class AsignacionesTemaController {
  constructor(private readonly asignaciones: AsignacionesTemaService) {}

  @Post('postulaciones/:id/asignar-tema')
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Aceptar una postulación y asignar su tema en una operación atómica' })
  @ApiCreatedResponse({ type: AsignacionTemaResponseDto })
  @ApiBadRequestResponse({ description: 'El motivo es inválido o excede 1000 caracteres.' })
  @ApiForbiddenResponse({ description: 'Se requiere ADMIN activo.' })
  @ApiNotFoundResponse({ description: 'No existe el período o la postulación indicada.' })
  @ApiConflictResponse({ description: 'Período, candidatura, conflicto, elegibilidad o disponibilidad incompatibles.' })
  assign(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: AsignarTemaDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.asignaciones.assign(periodoId, id, dto, actor, request.ip ?? null);
  }

  @Post('asignaciones-tema/:id/anular')
  @HttpCode(HttpStatus.OK)
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Anular manualmente una asignación vigente y republicar su tema' })
  @ApiOkResponse({ type: AsignacionTemaResponseDto })
  @ApiBadRequestResponse({ description: 'La causa no es válida o el motivo está vacío o excede 1000 caracteres.' })
  @ApiForbiddenResponse({ description: 'Se requiere ADMIN activo.' })
  @ApiNotFoundResponse({ description: 'No existe el período o la asignación indicada.' })
  @ApiConflictResponse({ description: 'El período está ARCHIVADO o la asignación no está VIGENTE.' })
  annul(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: AnularAsignacionTemaDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.asignaciones.anular(periodoId, id, dto, actor, request.ip ?? null);
  }

  @Get('asignaciones-tema')
  @Roles(UsuarioRol.ADMIN, UsuarioRol.DOCENTE)
  @ApiOperation({ summary: 'Listar asignaciones; DOCENTE consulta solo temas de su autoría' })
  @ApiOkResponse({ type: PagedAsignacionesTemaResponseDto })
  list(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Query() query: ListAsignacionesTemaQueryDto, @CurrentUsuario() actor: Usuario) {
    return this.asignaciones.list(periodoId, query, actor, actor.rol === UsuarioRol.ADMIN);
  }

  @Get('asignaciones-tema/me')
  @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Consultar asignaciones actuales e históricas donde participa el estudiante' })
  @ApiOkResponse({ type: PagedAsignacionesTemaResponseDto })
  listMine(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Query() query: ListAsignacionesTemaQueryDto, @CurrentUsuario() actor: Usuario) {
    return this.asignaciones.listMine(periodoId, actor, query);
  }

  @Get('asignaciones-tema/:id')
  @Roles(UsuarioRol.ADMIN, UsuarioRol.DOCENTE, UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Consultar detalle con validación de acceso al recurso' })
  @ApiOkResponse({ type: AsignacionTemaResponseDto })
  @ApiNotFoundResponse({ description: 'La asignación no existe o no es visible para el usuario.' })
  getById(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @CurrentUsuario() actor: Usuario) {
    return this.asignaciones.getById(periodoId, id, actor, actor.rol === UsuarioRol.ADMIN);
  }
}
