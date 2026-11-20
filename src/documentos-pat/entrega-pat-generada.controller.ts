import { Controller, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../common/roles.decorator.js';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { DocumentoPatResponseDto } from './dto/documento-pat-response.dto.js';
import { DocumentosPatService } from './documentos-pat.service.js';

/** Entrega directa del PAT generado sin firma; la carga firmada (`POST .../documentos-pat`) queda como opción. */
@ApiTags('Documentos PAT')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL no disponible.' })
@Controller('periodos/:periodoId/asignaciones-tema/:asignacionId/pat/me/generaciones/:id/entregar')
export class EntregaPatGeneradaController {
  constructor(private readonly documentos: DocumentosPatService) {}

  @Post()
  @Roles(UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Entregar como nueva versión el PDF generado (sin firma); referencia el archivo de la generación' })
  @ApiCreatedResponse({ type: DocumentoPatResponseDto })
  @ApiForbiddenResponse({ description: 'Solo el titular o un integrante activo entrega su PAT individual.' })
  @ApiNotFoundResponse({ description: 'Asignación o generación inexistentes o ajenas.' })
  @ApiConflictResponse({ description: 'Generación no lista o ya entregada, última versión pendiente o aprobada, período o asignación no vigentes.' })
  entregar(
    @Param('periodoId', new ParseUUIDPipe()) periodoId: string,
    @Param('asignacionId', new ParseUUIDPipe()) asignacionId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUsuario() actor: Usuario,
    @Req() request: Request,
  ) {
    return this.documentos.entregarGenerada(periodoId, asignacionId, id, actor, request.ip ?? null);
  }
}
