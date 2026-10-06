import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { Roles } from '../common/roles.decorator.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { ConflictosService } from './conflictos.service.js';
import { ResolverConflictoDto } from './dto/resolver-conflicto.dto.js';
import { ListConflictosQueryDto } from './dto/list-conflictos-query.dto.js';
import { ConflictoDetalleResponseDto, ConflictosPageResponseDto } from './dto/conflicto-response.dto.js';

@ApiTags('Conflictos')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiForbiddenResponse({ description: 'Se requiere una cuenta ADMIN activa.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no está disponible.' })
@Controller('periodos/:periodoId')
@Roles(UsuarioRol.ADMIN)
export class ConflictosController {
  constructor(private readonly conflictos: ConflictosService) {}

  @Get('conflictos')
  @ApiOperation({ summary: 'Listar temas con competencia o conflicto resuelto' })
  @ApiOkResponse({ type: ConflictosPageResponseDto, description: 'Temas paginados y cantidad de candidaturas elegibles.' })
  @ApiBadRequestResponse({ description: 'Paginación o filtro de estado inválido.' })
  list(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Query() query: ListConflictosQueryDto) {
    return this.conflictos.list(periodoId, query);
  }

  @Get('temas/:temaId/conflicto')
  @ApiOperation({ summary: 'Consultar candidaturas elegibles y resolución del tema' })
  @ApiOkResponse({ type: ConflictoDetalleResponseDto, description: 'Detalle de elegibilidad e historial de decisión, si existe.' })
  @ApiNotFoundResponse({ description: 'No existe el período o tema indicado.' })
  detail(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('temaId', new ParseUUIDPipe()) temaId: string) {
    return this.conflictos.detail(periodoId, temaId);
  }

  @Post('temas/:temaId/conflicto/resolver')
  @ApiOperation({ summary: 'Registrar la evaluación administrativa del conflicto' })
  @ApiCreatedResponse({ type: ConflictoDetalleResponseDto, description: 'Decisión guardada con sus participantes; no asigna el tema.' })
  @ApiBadRequestResponse({ description: 'Criterio, puntajes o participantes inválidos.' })
  @ApiConflictResponse({ description: 'El período no está cerrado o las candidaturas cambiaron.' })
  @ApiNotFoundResponse({ description: 'No existe el período o tema indicado.' })
  resolve(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('temaId', new ParseUUIDPipe()) temaId: string, @Body() dto: ResolverConflictoDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.conflictos.resolve(periodoId, temaId, dto, actor, request.ip || null);
  }
}
