import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiForbiddenResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import 'multer';
import { Roles } from '../common/roles.decorator.js';
import { CargarDocumentoPatDto } from '../documentos-pat/dto/cargar-documento-pat.dto.js';
import { DocumentosPatService } from '../documentos-pat/documentos-pat.service.js';
import { DescargaGeneracionPatQueryDto } from '../generaciones-pat/dto/actualizar-datos-pat.dto.js';
import { GeneracionesPatService } from '../generaciones-pat/generaciones-pat.service.js';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { ConfirmarPatInversoDto } from './dto/confirmar-pat-inverso.dto.js';
import { PAT_DOCX_MAX_BYTES } from './docx-seguro.js';
import { PatInversoService } from './pat-inverso.service.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

@ApiTags('PAT inverso (ADMIN)')
@ApiBearerAuth('bearer')
@ApiForbiddenResponse({ description: 'Se requiere ADMIN activo.' })
@Controller('periodos/:periodoId/equipos/:asignacionId/integrantes/:estudianteId')
@Roles(UsuarioRol.ADMIN)
export class PatInversoController {
  constructor(
    private readonly pat: PatInversoService,
    private readonly generaciones: GeneracionesPatService,
    private readonly documentos: DocumentosPatService,
  ) {}

  @Post('pat-inverso')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: PAT_DOCX_MAX_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['archivo'], properties: { archivo: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Leer el Word oficial PAT-04-F-002 llenado y devolver la vista previa' })
  @ApiCreatedResponse({ description: 'Vista previa con valores, diferencias, errores y coincidencia de tutor.' })
  preparar(
    @Param('periodoId', new ParseUUIDPipe()) periodoId: string,
    @Param('asignacionId', new ParseUUIDPipe()) asignacionId: string,
    @Param('estudianteId', new ParseUUIDPipe()) estudianteId: string,
    @UploadedFile() archivo: Express.Multer.File | undefined,
    @CurrentUsuario() actor: Usuario,
    @Req() request: Request,
  ) {
    if (!archivo?.buffer?.length) throw new BadRequestException('Adjunta el Word del PAT en el campo archivo.');
    return this.pat.preparar(periodoId, asignacionId, estudianteId, archivo.buffer, archivo.mimetype || DOCX_MIME, actor, request.ip ?? null);
  }

  @Post('pat-inverso/:preparacionId/confirmar')
  @ApiOperation({ summary: 'Confirmar la vista previa: guarda los datos del PAT y deja el tutor vigente' })
  confirmar(
    @Param('periodoId', new ParseUUIDPipe()) periodoId: string,
    @Param('asignacionId', new ParseUUIDPipe()) asignacionId: string,
    @Param('estudianteId', new ParseUUIDPipe()) estudianteId: string,
    @Param('preparacionId', new ParseUUIDPipe()) preparacionId: string,
    @Body() dto: ConfirmarPatInversoDto,
    @CurrentUsuario() actor: Usuario,
    @Req() request: Request,
  ) {
    return this.pat.confirmar(periodoId, asignacionId, estudianteId, preparacionId, dto.candidato_id, actor, request.ip ?? null);
  }

  @Post('generar-pat')
  @ApiOperation({ summary: 'Generar el PAT oficial del estudiante a partir de los datos ya confirmados' })
  generar(
    @Param('periodoId', new ParseUUIDPipe()) periodoId: string,
    @Param('asignacionId', new ParseUUIDPipe()) asignacionId: string,
    @Param('estudianteId', new ParseUUIDPipe()) estudianteId: string,
    @CurrentUsuario() actor: Usuario,
    @Req() request: Request,
  ) {
    return this.generaciones.solicitarParaEstudiante(periodoId, asignacionId, estudianteId, actor, request.ip ?? null);
  }

  @Get('generaciones/:generacionId/descarga')
  @ApiOperation({ summary: 'Descargar el Word o el PDF del PAT generado para el estudiante' })
  descargar(
    @Param('periodoId', new ParseUUIDPipe()) periodoId: string,
    @Param('asignacionId', new ParseUUIDPipe()) asignacionId: string,
    @Param('estudianteId', new ParseUUIDPipe()) estudianteId: string,
    @Param('generacionId', new ParseUUIDPipe()) generacionId: string,
    @Query() query: DescargaGeneracionPatQueryDto,
    @CurrentUsuario() actor: Usuario,
  ) {
    return this.generaciones.descargaDeEstudiante(periodoId, asignacionId, generacionId, estudianteId, actor, query.formato ?? 'pdf');
  }

  @Post('documento-pat')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: PAT_DOCX_MAX_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Subir el PDF firmado y escaneado del estudiante' })
  entregar(
    @Param('periodoId', new ParseUUIDPipe()) periodoId: string,
    @Param('asignacionId', new ParseUUIDPipe()) asignacionId: string,
    @Param('estudianteId', new ParseUUIDPipe()) estudianteId: string,
    @Body() dto: CargarDocumentoPatDto,
    @UploadedFile() archivo: Express.Multer.File | undefined,
    @CurrentUsuario() actor: Usuario,
    @Req() request: Request,
  ) {
    return this.documentos.cargarFirmadoDeEstudiante(periodoId, asignacionId, estudianteId, dto, archivo, actor, request.ip ?? null);
  }
}
