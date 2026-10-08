import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, Req, UseInterceptors } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiConsumes, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiPayloadTooLargeResponse, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse, ApiUnsupportedMediaTypeResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { Roles } from '../common/roles.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { PublicarPlantillaPatDto } from './dto/publicar-plantilla-pat.dto.js';
import { PagedPlantillaPatResponseDto, PlantillaPatDownloadDto, PlantillaPatResponseDto } from './dto/plantilla-pat-response.dto.js';
import { PlantillaPatUploadInterceptor } from './plantilla-pat-upload.interceptor.js';
import { PlantillasPatService } from './plantillas-pat.service.js';

@ApiTags('Plantillas PAT')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'Token ausente o inválido.' })
@ApiServiceUnavailableResponse({ description: 'PostgreSQL o almacenamiento no disponibles.' })
@Controller('periodos/:periodoId/plantillas-pat')
export class PlantillasPatController {
  constructor(private readonly plantillas: PlantillasPatService) {}

  @Post()
  @Roles(UsuarioRol.ADMIN)
  @UseInterceptors(PlantillaPatUploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['version', 'archivo'], properties: { version: { type: 'string', maxLength: 20 }, archivo: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Publicar una nueva versión de plantilla PAT y sustituir la vigente' })
  @ApiCreatedResponse({ type: PlantillaPatResponseDto })
  @ApiBadRequestResponse({ description: 'Versión o contenido inválidos.' })
  @ApiUnsupportedMediaTypeResponse({ description: 'Solo PDF o DOCX válido.' })
  @ApiPayloadTooLargeResponse({ description: 'El archivo supera 10 MiB.' })
  @ApiConflictResponse({ description: 'Versión duplicada o período archivado.' })
  publicar(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Body() dto: PublicarPlantillaPatDto, @Req() request: Request, @CurrentUsuario() actor: Usuario) {
    const file = (request as Request & { file?: Express.Multer.File }).file;
    return this.plantillas.publicar(periodoId, dto, file, actor, request.ip ?? null);
  }

  @Get()
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Consultar las versiones históricas del período' })
  @ApiOkResponse({ type: PagedPlantillaPatResponseDto })
  listar(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Query() query: PaginationQueryDto) {
    return this.plantillas.listar(periodoId, query.page, query.limit);
  }

  @Get('vigente/descarga')
  @Roles(UsuarioRol.ADMIN, UsuarioRol.ESTUDIANTE)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Obtener URL temporal para descargar la plantilla vigente' })
  @ApiOkResponse({ type: PlantillaPatDownloadDto })
  @ApiForbiddenResponse({ description: 'El estudiante no está habilitado en el período.' })
  @ApiNotFoundResponse({ description: 'El período no tiene una plantilla vigente.' })
  descargarVigente(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @CurrentUsuario() actor: Usuario) {
    return this.plantillas.descargarVigente(periodoId, actor);
  }

  @Get('vigente')
  @Roles(UsuarioRol.ADMIN, UsuarioRol.ESTUDIANTE)
  @ApiOperation({ summary: 'Consultar metadatos de la plantilla vigente' })
  @ApiOkResponse({ type: PlantillaPatResponseDto })
  @ApiForbiddenResponse({ description: 'El estudiante no está habilitado en el período.' })
  @ApiNotFoundResponse({ description: 'El período no tiene una plantilla vigente.' })
  vigente(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @CurrentUsuario() actor: Usuario) {
    return this.plantillas.vigente(periodoId, actor);
  }

  @Get(':id/descarga')
  @Roles(UsuarioRol.ADMIN)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Obtener URL temporal de una versión histórica' })
  @ApiOkResponse({ type: PlantillaPatDownloadDto })
  @ApiNotFoundResponse({ description: 'No existe la versión en el período indicado.' })
  descargarVersion(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.plantillas.descargarPorId(periodoId, id);
  }

  @Get(':id')
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({ summary: 'Consultar metadatos de una versión histórica' })
  @ApiOkResponse({ type: PlantillaPatResponseDto })
  @ApiNotFoundResponse({ description: 'No existe la versión en el período indicado.' })
  porId(@Param('periodoId', new ParseUUIDPipe()) periodoId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.plantillas.porId(periodoId, id);
  }
}
