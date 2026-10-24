import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiAcceptedResponse, ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/roles.decorator.js';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CuerpoVacioDto } from './dto/cuerpo-vacio.dto.js';
import { ExportacionDescargaDto, ExportacionPageDto, ExportacionResponseDto } from './dto/exportacion-response.dto.js';
import { ListarExportacionesQueryDto } from './dto/listar-exportaciones-query.dto.js';
import { SolicitarExportacionDto } from './dto/solicitar-exportacion.dto.js';
import { ExportacionesService } from './exportaciones.service.js';

@ApiTags('Exportaciones')
@ApiBearerAuth('bearer')
@ApiForbiddenResponse({ description: 'Se requiere una cuenta ADMIN activa.' })
@ApiServiceUnavailableResponse({ description: 'No se pudo completar la operación.' })
@Controller('periodos/:periodoId/exportaciones')
@Roles(UsuarioRol.ADMIN)
export class ExportacionesController {
  constructor(private readonly service: ExportacionesService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Solicitar un reporte administrativo en segundo plano' })
  @ApiAcceptedResponse({ schema: { example: { id: 'uuid', estado: 'EN_COLA' } } })
  @ApiBadRequestResponse({ description: 'El tipo, formato o filtros no corresponden.' })
  @ApiNotFoundResponse({ description: 'El período no existe.' })
  solicitar(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Body() dto: SolicitarExportacionDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.service.solicitar(periodoId, dto, actor, request.ip ?? null);
  }

  @Get()
  @ApiOperation({ summary: 'Listar solicitudes propias del período' })
  @ApiOkResponse({ type: ExportacionPageDto })
  listar(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @CurrentUsuario() actor: Usuario, @Query() query: ListarExportacionesQueryDto) {
    return this.service.listar(periodoId, actor, query);
  }

  @Get(':id/descarga')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Obtener URL temporal para descargar un reporte generado' })
  @ApiOkResponse({ type: ExportacionDescargaDto })
  @ApiConflictResponse({ description: 'El reporte aún no está listo o ya expiró.' })
  descarga(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @CurrentUsuario() actor: Usuario) {
    return this.service.descarga(periodoId, id, actor);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar el estado de una solicitud propia' })
  @ApiOkResponse({ type: ExportacionResponseDto })
  @ApiNotFoundResponse({ description: 'La solicitud no existe o pertenece a otro usuario.' })
  porId(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @CurrentUsuario() actor: Usuario) {
    return this.service.porId(periodoId, id, actor);
  }

  @Post(':id/reintentar')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Reintentar una solicitud fallida' })
  @ApiAcceptedResponse({ schema: { example: { id: 'uuid', estado: 'EN_COLA' } } })
  @ApiConflictResponse({ description: 'Solo se reintentan solicitudes en estado FALLIDO.' })
  reintentar(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() _body: CuerpoVacioDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.service.reintentar(periodoId, id, actor, request.ip ?? null);
  }
}
