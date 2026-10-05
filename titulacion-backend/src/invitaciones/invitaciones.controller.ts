import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../common/roles.decorator.js';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CreateInvitacionDto } from './dto/create-invitacion.dto.js';
import { EmptyActionDto } from './dto/empty-action.dto.js';
import { InvitacionResponseDto, PagedInvitacionesResponseDto } from './dto/invitacion-response.dto.js';
import { ListInvitacionesQueryDto } from './dto/list-invitaciones-query.dto.js';
import { InvitacionesService } from './invitaciones.service.js';

@ApiTags('Invitaciones')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no está disponible.' })
@Controller()
export class InvitacionesController {
  constructor(private readonly invitaciones: InvitacionesService) {}

  @Post('periodos/:periodoId/grupos/:grupoId/invitaciones')
  @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Invitar a un estudiante como representante del grupo' })
  @ApiCreatedResponse({ type: InvitacionResponseDto })
  @ApiBadRequestResponse({ description: 'El identificador del destinatario no es válido.' })
  @ApiForbiddenResponse({ description: 'Solo el representante activo puede enviar invitaciones.' })
  @ApiNotFoundResponse({ description: 'Grupo o estudiante inexistente.' })
  @ApiConflictResponse({ description: 'Plazo cerrado, cupo alcanzado, estudiante no habilitado o invitación duplicada.' })
  create(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('grupoId', new ParseUUIDPipe()) grupoId: string, @Body() dto: CreateInvitacionDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.invitaciones.create(periodoId, grupoId, actor, dto, request.ip || null);
  }

  @Get('periodos/:periodoId/grupos/:grupoId/invitaciones')
  @Roles(UsuarioRol.ESTUDIANTE, UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Consultar invitaciones enviadas por un grupo (representante o ADMIN)' })
  @ApiOkResponse({ type: PagedInvitacionesResponseDto })
  @ApiForbiddenResponse({ description: 'Solo ADMIN o representante del grupo.' })
  @ApiNotFoundResponse({ description: 'Grupo inexistente o ajeno.' })
  listSent(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('grupoId', new ParseUUIDPipe()) grupoId: string, @CurrentUsuario() actor: Usuario, @Query() query: ListInvitacionesQueryDto) {
    return this.invitaciones.listSent(periodoId, grupoId, actor, actor.rol === UsuarioRol.ADMIN, query);
  }

  @Get('periodos/:periodoId/invitaciones/me')
  @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Consultar las invitaciones recibidas por el estudiante' })
  @ApiOkResponse({ type: PagedInvitacionesResponseDto })
  @ApiNotFoundResponse({ description: 'No existe perfil de estudiante.' })
  listReceived(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @CurrentUsuario() actor: Usuario, @Query() query: ListInvitacionesQueryDto) {
    return this.invitaciones.listReceived(periodoId, actor, query);
  }

  @Post('periodos/:periodoId/invitaciones/:id/aceptar')
  @HttpCode(200)
  @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Aceptar invitación pendiente como destinatario' })
  @ApiOkResponse({ type: InvitacionResponseDto })
  @ApiForbiddenResponse({ description: 'Se requiere una cuenta estudiante activa.' })
  @ApiNotFoundResponse({ description: 'La invitación no existe o no fue enviada a esta cuenta.' })
  @ApiConflictResponse({ description: 'Invitación vencida, plazo cerrado, falta de elegibilidad o cupo/estado incompatible.' })
  accept(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() _body: EmptyActionDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.invitaciones.accept(periodoId, id, actor, request.ip || null);
  }

  @Post('periodos/:periodoId/invitaciones/:id/rechazar')
  @HttpCode(200)
  @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Rechazar invitación pendiente como destinatario' })
  @ApiOkResponse({ type: InvitacionResponseDto })
  @ApiNotFoundResponse({ description: 'La invitación no existe o no fue enviada a esta cuenta.' })
  @ApiConflictResponse({ description: 'La invitación ya fue resuelta o venció.' })
  reject(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() _body: EmptyActionDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.invitaciones.reject(periodoId, id, actor, request.ip || null);
  }

  @Post('periodos/:periodoId/invitaciones/:id/cancelar')
  @HttpCode(200)
  @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Cancelar invitación pendiente como emisor' })
  @ApiOkResponse({ type: InvitacionResponseDto })
  @ApiNotFoundResponse({ description: 'La invitación no existe o no fue enviada por esta cuenta.' })
  @ApiConflictResponse({ description: 'La invitación ya fue resuelta o venció.' })
  cancel(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() _body: EmptyActionDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.invitaciones.cancel(periodoId, id, actor, request.ip || null);
  }
}
