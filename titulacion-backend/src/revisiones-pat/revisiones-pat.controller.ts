import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { Roles } from '../common/roles.decorator.js';
import { CrearRevisionPatDto } from './dto/crear-revision-pat.dto.js';
import { RevisionPatResponseDto } from './dto/revision-pat-response.dto.js';
import { RevisionesPatService } from './revisiones-pat.service.js';

@ApiTags('Revisiones PAT')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no está disponible.' })
@Controller('periodos/:periodoId/asignaciones-tema/:asignacionId/documentos-pat/:documentoId/revision')
export class RevisionesPatController {
  constructor(private readonly revisiones: RevisionesPatService) {}

  @Post()
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Registrar la revisión de una versión PAT' })
  @ApiCreatedResponse({ type: RevisionPatResponseDto })
  @ApiBadRequestResponse({ description: 'Resultado u observaciones inválidos.' })
  @ApiForbiddenResponse({ description: 'Se requiere ADMIN activo.' })
  @ApiNotFoundResponse({ description: 'Período, asignación o versión inexistentes.' })
  @ApiConflictResponse({ description: 'Estado incompatible o versión ya revisada.' })
  crear(
    @Param('periodoId', new ParseUUIDPipe()) periodoId: string,
    @Param('asignacionId', new ParseUUIDPipe()) asignacionId: string,
    @Param('documentoId', new ParseUUIDPipe()) documentoId: string,
    @Body() dto: CrearRevisionPatDto,
    @CurrentUsuario() actor: Usuario,
    @Req() request: Request,
  ) { return this.revisiones.crear(periodoId, asignacionId, documentoId, dto, actor, request.ip ?? null); }

  @Get()
  @Roles(UsuarioRol.ADMIN, UsuarioRol.ESTUDIANTE, UsuarioRol.DOCENTE)
  @ApiOperation({ summary: 'Consultar el resultado y las observaciones de una versión PAT' })
  @ApiOkResponse({ type: RevisionPatResponseDto })
  @ApiForbiddenResponse({ description: 'Sin permiso para acceder al trabajo.' })
  @ApiNotFoundResponse({ description: 'Trabajo o revisión inexistentes.' })
  obtener(
    @Param('periodoId', new ParseUUIDPipe()) periodoId: string,
    @Param('asignacionId', new ParseUUIDPipe()) asignacionId: string,
    @Param('documentoId', new ParseUUIDPipe()) documentoId: string,
    @CurrentUsuario() actor: Usuario,
  ) { return this.revisiones.obtener(periodoId, asignacionId, documentoId, actor); }
}
