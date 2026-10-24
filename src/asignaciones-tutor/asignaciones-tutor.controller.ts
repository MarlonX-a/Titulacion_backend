import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { Roles } from '../common/roles.decorator.js';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { AsignarTutorDto } from './dto/asignar-tutor.dto.js';
import { ReemplazarTutorDto } from './dto/reemplazar-tutor.dto.js';
import { ListAsignacionesTutorQueryDto } from './dto/list-asignaciones-tutor-query.dto.js';
import { AsignacionTutorResponseDto, CargaTutorActualResponseDto, PagedAsignacionTutorResponseDto, ResultadoAsignacionTutorResponseDto } from './dto/asignacion-tutor-response.dto.js';
import { PagedTutorPropuestoAsignacionResponseDto } from './dto/tutor-propuesto-asignacion-response.dto.js';
import { AsignacionesTutorService } from './asignaciones-tutor.service.js';

@ApiTags('Asignación de tutor')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no está disponible.' })
@Controller('periodos/:periodoId')
export class AsignacionesTutorController {
  constructor(private readonly asignaciones: AsignacionesTutorService) {}

  @Post('asignaciones-tema/:id/asignar-tutor')
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Asignar al trabajo un tutor propuesto o directamente' })
  @ApiCreatedResponse({ type: ResultadoAsignacionTutorResponseDto })
  @ApiBadRequestResponse({ description: 'Los identificadores o el cuerpo no son válidos.' })
  @ApiConflictResponse({ description: 'El período, trabajo, tutor o configuración de carga no permiten asignar.' })
  assign(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: AsignarTutorDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.asignaciones.asignar(periodoId, id, dto, actor, request.ip ?? null);
  }

  @Post('asignaciones-tutor/:id/reemplazar')
  @Roles(UsuarioRol.ADMIN)
  @ApiCreatedResponse({ type: ResultadoAsignacionTutorResponseDto })
  @ApiOperation({ summary: 'Reemplazar un tutor vigente y conservar su registro histórico' })
  @ApiBadRequestResponse({ description: 'El motivo o los identificadores no son válidos.' })
  @ApiConflictResponse({ description: 'El tutor ya no está vigente o el reemplazo incumple la carga.' })
  replace(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ReemplazarTutorDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.asignaciones.reemplazar(periodoId, id, dto, actor, request.ip ?? null);
  }

  @Get('asignaciones-tema/:id/tutores-propuestos')
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Consultar preferencias ordenadas con el proponente primero si fue propuesto' })
  @ApiOkResponse({ type: PagedTutorPropuestoAsignacionResponseDto })
  listProposed(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @Query() query: PaginationQueryDto) {
    return this.asignaciones.listarPropuestos(periodoId, id, query.page, query.limit);
  }

  @Get('asignaciones-tutor/me')
  @Roles(UsuarioRol.DOCENTE, UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Consultar asignaciones de tutor propias e históricas' })
  @ApiOkResponse({ type: PagedAsignacionTutorResponseDto })
  listMine(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Query() query: ListAsignacionesTutorQueryDto, @CurrentUsuario() actor: Usuario) {
    return this.asignaciones.listMine(periodoId, actor, query);
  }

  @Get('asignaciones-tutor')
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Listar las asignaciones e historial de tutores del período' })
  @ApiOkResponse({ type: PagedAsignacionTutorResponseDto })
  list(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Query() query: ListAsignacionesTutorQueryDto) {
    return this.asignaciones.list(periodoId, query);
  }

  @Get('asignaciones-tutor/:id')
  @Roles(UsuarioRol.ADMIN, UsuarioRol.DOCENTE, UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Consultar una asignación con autorización por tutor o participante' })
  @ApiOkResponse({ type: AsignacionTutorResponseDto })
  @ApiNotFoundResponse({ description: 'La asignación no existe o no es visible para el usuario.' })
  getById(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @CurrentUsuario() actor: Usuario) {
    return this.asignaciones.getById(periodoId, id, actor);
  }

  @Get('carga-tutorial/me')
  @Roles(UsuarioRol.DOCENTE)
  @ApiOperation({ summary: 'Consultar la carga actual y límite aplicable propio' })
  @ApiOkResponse({ type: CargaTutorActualResponseDto })
  cargaMine(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @CurrentUsuario() actor: Usuario) {
    return this.asignaciones.cargaDeUsuario(periodoId, actor);
  }

  @Get('carga-tutorial/:docenteId')
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Consultar la carga actual y límite aplicable de un docente' })
  @ApiOkResponse({ type: CargaTutorActualResponseDto })
  cargaDocente(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('docenteId', new ParseUUIDPipe()) docenteId: string) {
    return this.asignaciones.cargaActual(periodoId, docenteId);
  }
}
