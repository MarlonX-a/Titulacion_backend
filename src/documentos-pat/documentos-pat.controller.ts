import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiConsumes, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiPayloadTooLargeResponse, ApiServiceUnavailableResponse, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse, ApiUnsupportedMediaTypeResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { Roles } from '../common/roles.decorator.js';
import { RateLimit } from '../common/http/rate-limit.decorator.js';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CargarDocumentoPatDto } from './dto/cargar-documento-pat.dto.js';
import { DocumentoPatDownloadDto, DocumentoPatResponseDto, PagedDocumentoPatResponseDto } from './dto/documento-pat-response.dto.js';
import { DocumentoPatCargaGuard } from './documento-pat-carga.guard.js';
import { DocumentoPatUploadInterceptor } from './documento-pat-upload.interceptor.js';
import { DocumentosPatService } from './documentos-pat.service.js';

@ApiTags('Documentos PAT')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL o almacenamiento no disponibles.' })
@Controller('periodos/:periodoId/asignaciones-tema/:asignacionId/documentos-pat')
export class DocumentosPatController {
  constructor(private readonly documentos: DocumentosPatService) {}

  @Post()
  @Roles(UsuarioRol.ESTUDIANTE)
  // 10 intentos por usuario y hora (cuentan también los rechazados): una entrega corregida solo
  // es posible tras una revisión, así que el uso real queda muy por debajo del límite. Además, una
  // sola subida simultánea por usuario: multer guarda hasta 10 MiB en memoria por solicitud. El
  // vencimiento del cupo coincide con el plazo predeterminado de una solicitud en Node (300 s).
  @RateLimit({ clave: 'subir-pat', limite: 10, ventanaSegundos: 3600, concurrencia: { limite: 1, ttlSegundos: 300 } })
  @UseGuards(DocumentoPatCargaGuard)
  @UseInterceptors(DocumentoPatUploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['archivo', 'plantilla_id'], properties: { plantilla_id: { type: 'string', format: 'uuid' }, archivo: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Entregar una versión del PAT del trabajo' })
  @ApiCreatedResponse({ type: DocumentoPatResponseDto })
  @ApiBadRequestResponse({ description: 'Identificador, plantilla o contenido inválido.' })
  @ApiForbiddenResponse({ description: 'Solo el titular o representante actual puede entregar.' })
  @ApiConflictResponse({ description: 'Asignación, período o plantilla incompatibles.' })
  @ApiUnsupportedMediaTypeResponse({ description: 'Solo PDF o DOCX válido.' })
  @ApiPayloadTooLargeResponse({ description: 'El archivo supera 10 MiB.' })
  @ApiTooManyRequestsResponse({ description: 'Se superó el límite de 10 entregas por hora o ya hay una subida en curso del mismo usuario.' })
  cargar(
    @Param('periodoId', new ParseUUIDPipe()) periodoId: string,
    @Param('asignacionId', new ParseUUIDPipe()) asignacionId: string,
    @Body() dto: CargarDocumentoPatDto,
    @Req() request: Request,
    @CurrentUsuario() actor: Usuario,
  ) {
    const file = (request as Request & { file?: Express.Multer.File }).file;
    return this.documentos.cargar(periodoId, asignacionId, dto, file, actor, request.ip ?? null);
  }

  @Get()
  @Roles(UsuarioRol.ADMIN, UsuarioRol.ESTUDIANTE, UsuarioRol.DOCENTE)
  @ApiOperation({ summary: 'Consultar el historial de versiones del PAT' })
  @ApiOkResponse({ type: PagedDocumentoPatResponseDto })
  listar(
    @Param('periodoId', new ParseUUIDPipe()) periodoId: string,
    @Param('asignacionId', new ParseUUIDPipe()) asignacionId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUsuario() actor: Usuario,
  ) { return this.documentos.listar(periodoId, asignacionId, actor, query.page, query.limit); }

  @Get('ultima/descarga')
  @Roles(UsuarioRol.ADMIN, UsuarioRol.ESTUDIANTE, UsuarioRol.DOCENTE)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Obtener URL temporal de descarga de la última versión' })
  @ApiOkResponse({ type: DocumentoPatDownloadDto })
  descargarUltima(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('asignacionId', new ParseUUIDPipe()) asignacionId: string, @CurrentUsuario() actor: Usuario) {
    return this.documentos.descargarUltima(periodoId, asignacionId, actor);
  }

  @Get('ultima')
  @Roles(UsuarioRol.ADMIN, UsuarioRol.ESTUDIANTE, UsuarioRol.DOCENTE)
  @ApiOperation({ summary: 'Consultar los metadatos de la última versión' })
  @ApiOkResponse({ type: DocumentoPatResponseDto })
  ultima(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('asignacionId', new ParseUUIDPipe()) asignacionId: string, @CurrentUsuario() actor: Usuario) {
    return this.documentos.ultima(periodoId, asignacionId, actor);
  }

  @Get(':id/descarga')
  @Roles(UsuarioRol.ADMIN, UsuarioRol.ESTUDIANTE, UsuarioRol.DOCENTE)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Obtener URL temporal de una versión histórica' })
  @ApiOkResponse({ type: DocumentoPatDownloadDto })
  descargarVersion(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('asignacionId', new ParseUUIDPipe()) asignacionId: string, @Param('id', new ParseUUIDPipe()) id: string, @CurrentUsuario() actor: Usuario) {
    return this.documentos.descargarPorId(periodoId, asignacionId, id, actor);
  }

  @Get(':id')
  @Roles(UsuarioRol.ADMIN, UsuarioRol.ESTUDIANTE, UsuarioRol.DOCENTE)
  @ApiOperation({ summary: 'Consultar metadatos de una versión histórica' })
  @ApiOkResponse({ type: DocumentoPatResponseDto })
  @ApiForbiddenResponse({ description: 'Sin acceso al trabajo.' })
  @ApiNotFoundResponse({ description: 'Trabajo o versión inexistentes.' })
  porId(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('asignacionId', new ParseUUIDPipe()) asignacionId: string, @Param('id', new ParseUUIDPipe()) id: string, @CurrentUsuario() actor: Usuario) {
    return this.documentos.porId(periodoId, asignacionId, id, actor);
  }
}
