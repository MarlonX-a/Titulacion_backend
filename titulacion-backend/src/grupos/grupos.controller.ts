import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { Roles } from '../common/roles.decorator.js';
import { CreateGrupoDto } from './dto/create-grupo.dto.js';
import { MotivoGrupoDto } from './dto/motivo-grupo.dto.js';
import { CambiarRepresentanteDto } from './dto/cambiar-representante.dto.js';
import { RetirarIntegranteDto } from './dto/retirar-integrante.dto.js';
import type { Request } from 'express';
import { GrupoResponseDto, PagedGruposResponseDto } from './dto/grupo-response.dto.js';
import { ListGruposQueryDto } from './dto/list-grupos-query.dto.js';
import { GruposService } from './grupos.service.js';
import { GrupoGestionService } from './grupo-gestion.service.js';

@ApiTags('Grupos')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no está disponible.' })
@Controller('periodos/:periodoId/grupos')
export class GruposController {
  constructor(private readonly grupos: GruposService, private readonly gestion: GrupoGestionService) {}

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

  @Post(':id/salir')
  @HttpCode(200)
  @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Retirarse de un grupo activo' })
  @ApiOkResponse({ type: GrupoResponseDto })
  @ApiBadRequestResponse({ description: 'Se requiere un motivo no vacío de hasta 1000 caracteres.' })
  @ApiForbiddenResponse({ description: 'Solo un estudiante activo puede salir.' })
  @ApiNotFoundResponse({ description: 'El estudiante no integra el grupo.' })
  @ApiConflictResponse({ description: 'Fuera del plazo, grupo no editable o el representante debe transferir primero el cargo.' })
  salir(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: MotivoGrupoDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.gestion.salir(periodoId, id, actor, dto, request.ip ?? null);
  }

  @Post(':id/cambiar-representante')
  @HttpCode(200)
  @Roles(UsuarioRol.ESTUDIANTE, UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Transferir la representación a un integrante elegible' })
  @ApiOkResponse({ type: GrupoResponseDto })
  @ApiBadRequestResponse({ description: 'ID inválido o motivo vacío.' })
  @ApiForbiddenResponse({ description: 'Solo el representante actual o ADMIN.' })
  @ApiNotFoundResponse({ description: 'No existe el grupo.' })
  @ApiConflictResponse({ description: 'Período o grupo no editable, integrante inválido o cuenta no elegible.' })
  cambiarRepresentante(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: CambiarRepresentanteDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.gestion.cambiarRepresentante(periodoId, id, actor, actor.rol === UsuarioRol.ADMIN, dto, request.ip ?? null);
  }

  @Post(':id/integrantes/:estudianteId/retirar')
  @HttpCode(200)
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Retirar administrativamente a un integrante' })
  @ApiOkResponse({ type: GrupoResponseDto })
  @ApiBadRequestResponse({ description: 'Identificador o motivo inválido.' })
  @ApiForbiddenResponse({ description: 'Solo ADMIN.' })
  @ApiNotFoundResponse({ description: 'No existe el grupo.' })
  @ApiConflictResponse({ description: 'El integrante no está activo, período no editable o falta reemplazo del representante.' })
  retirarIntegrante(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @Param('estudianteId', new ParseUUIDPipe()) estudianteId: string, @Body() dto: RetirarIntegranteDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.gestion.retirarIntegrante(periodoId, id, estudianteId, actor, dto, request.ip ?? null);
  }

  @Post(':id/disolver')
  @HttpCode(200)
  @Roles(UsuarioRol.ESTUDIANTE, UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Disolver un grupo y retirar a sus integrantes' })
  @ApiOkResponse({ type: GrupoResponseDto })
  @ApiBadRequestResponse({ description: 'Se requiere un motivo no vacío de hasta 1000 caracteres.' })
  @ApiForbiddenResponse({ description: 'Solo el representante activo o ADMIN.' })
  @ApiNotFoundResponse({ description: 'No existe el grupo.' })
  @ApiConflictResponse({ description: 'Período o grupo no editable.' })
  disolver(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: MotivoGrupoDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.gestion.disolver(periodoId, id, actor, actor.rol === UsuarioRol.ADMIN, dto, request.ip ?? null);
  }
}
