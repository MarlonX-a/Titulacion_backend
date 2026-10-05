import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { Roles } from '../common/roles.decorator.js';
import { CreateGrupoDto } from './dto/create-grupo.dto.js';
import type { Request } from 'express';
import { GrupoResponseDto, PagedGruposResponseDto } from './dto/grupo-response.dto.js';
import { ListGruposQueryDto } from './dto/list-grupos-query.dto.js';
import { GruposService } from './grupos.service.js';

@ApiTags('Grupos')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no está disponible.' })
@Controller('periodos/:periodoId/grupos')
export class GruposController {
  constructor(private readonly grupos: GruposService) {}

  @Post()
  @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Crear un grupo durante el plazo de postulación' })
  @ApiCreatedResponse({ type: GrupoResponseDto })
  @ApiBadRequestResponse({ description: 'Nombre vacío, demasiado largo o campos adicionales.' })
  @ApiForbiddenResponse({ description: 'Se requiere estudiante activo.' })
  @ApiNotFoundResponse({ description: 'No existe el perfil de estudiante o período.' })
  @ApiConflictResponse({ description: 'Período cerrado, estudiante no habilitado, cupo menor que dos o pertenencia previa.' })
  create(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Body() dto: CreateGrupoDto, @CurrentUsuario() actor: Usuario, @Req() request: Request): Promise<GrupoResponseDto> {
    return this.grupos.create(periodoId, actor, dto, request.ip ?? null);
  }

  @Get()
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Listar grupos del período (ADMIN)' })
  @ApiOkResponse({ type: PagedGruposResponseDto })
  list(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Query() query: ListGruposQueryDto) {
    return this.grupos.list(periodoId, query);
  }

  @Get('me')
  @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Consultar el grupo propio del estudiante' })
  @ApiOkResponse({ type: GrupoResponseDto })
  @ApiNotFoundResponse({ description: 'No existe perfil o pertenencia activa en el período.' })
  getMine(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @CurrentUsuario() actor: Usuario) {
    return this.grupos.getMine(periodoId, actor);
  }

  @Get(':id')
  @Roles(UsuarioRol.ADMIN, UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Consultar detalle administrativo o de integrante del grupo' })
  @ApiOkResponse({ type: GrupoResponseDto })
  @ApiForbiddenResponse({ description: 'Solo ADMIN o integrante activo del grupo.' })
  @ApiNotFoundResponse({ description: 'El grupo no existe o no es visible para el usuario.' })
  getById(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @CurrentUsuario() actor: Usuario) {
    return this.grupos.getById(periodoId, id, actor, actor.rol === UsuarioRol.ADMIN);
  }
}
