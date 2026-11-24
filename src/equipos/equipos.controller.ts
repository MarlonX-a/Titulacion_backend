import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../common/roles.decorator.js';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { AsignarTutorCandidatoDto } from './dto/asignar-tutor-candidato.dto.js';
import { CrearEquipoDto } from './dto/crear-equipo.dto.js';
import { EquipoResponseDto, PagedEquiposResponseDto, ResultadoEquipoResponseDto } from './dto/equipo-response.dto.js';
import { ListEquiposQueryDto } from './dto/list-equipos-query.dto.js';
import { EquiposConsultaService } from './equipos-consulta.service.js';
import { EquiposService } from './equipos.service.js';

@ApiTags('Equipos (ADMIN)')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiForbiddenResponse({ description: 'Se requiere ADMIN activo.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no está disponible.' })
@Controller('periodos/:periodoId/equipos')
@Roles(UsuarioRol.ADMIN)
export class EquiposController {
  constructor(private readonly equipos: EquiposService, private readonly consulta: EquiposConsultaService) {}

  @Post()
  @ApiOperation({ summary: 'Conformar un equipo (grupo o individual) con tema y candidatos a tutor, sin postulación' })
  @ApiCreatedResponse({ type: ResultadoEquipoResponseDto })
  @ApiBadRequestResponse({ description: 'Estudiantes, tema, candidatos o motivo inválidos (UUID, repetidos, cantidades o longitudes).' })
  @ApiNotFoundResponse({ description: 'No existe el período, el tema, un estudiante o un docente.' })
  @ApiConflictResponse({ description: 'Estado del período, disponibilidad del tema, composición, elegibilidad de estudiantes o docentes, o carga tutorial incompatibles.' })
  crear(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Body() dto: CrearEquipoDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.equipos.crear(periodoId, dto, actor, request.ip ?? null);
  }

  @Get()
  @ApiOperation({ summary: 'Listar los equipos conformados por ADMIN en el período' })
  @ApiOkResponse({ type: PagedEquiposResponseDto })
  @ApiNotFoundResponse({ description: 'No existe el período.' })
  listar(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Query() query: ListEquiposQueryDto) {
    return this.consulta.listar(periodoId, query);
  }

  @Get(':asignacionId')
  @ApiOperation({ summary: 'Detalle de un equipo: integrantes con su estado PAT, tema, candidatos y tutor vigente' })
  @ApiOkResponse({ type: EquipoResponseDto })
  @ApiNotFoundResponse({ description: 'No existe esa asignación en el período.' })
  detalle(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('asignacionId', new ParseUUIDPipe()) asignacionId: string) {
    return this.consulta.detalle(periodoId, asignacionId);
  }

  @Post(':asignacionId/tutor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Asignar como tutor vigente a uno de los candidatos del equipo (reemplaza con motivo si ya hay tutor)' })
  @ApiOkResponse({ type: ResultadoEquipoResponseDto })
  @ApiBadRequestResponse({ description: 'Candidato o motivo inválidos.' })
  @ApiNotFoundResponse({ description: 'No existe el período, el equipo o el candidato en el equipo.' })
  @ApiConflictResponse({ description: 'Período no operable, equipo no administrativo o no vigente, tutor ya vigente sin motivo, docente no elegible o carga superada.' })
  asignarTutor(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('asignacionId', new ParseUUIDPipe()) asignacionId: string, @Body() dto: AsignarTutorCandidatoDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.equipos.asignarTutorDesdeCandidatos(periodoId, asignacionId, dto, actor, request.ip ?? null);
  }
}
