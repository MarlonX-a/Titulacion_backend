import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiConsumes, ApiForbiddenResponse, ApiGoneResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import 'multer';
import { Roles } from '../common/roles.decorator.js';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { ConfirmarImportacionDto } from './confirmar-importacion.dto.js';
import { ResolverDocentesImportacionDto } from './dto/resolver-docentes-importacion.dto.js';
import { ValidarImportacionTemasDto } from './dto/validar-importacion-temas.dto.js';
import { ImportacionesTemasService } from './importaciones-temas.service.js';
import { XLSX_MIME, XLSX_UPLOAD_OPTIONS } from './importaciones.controller.js';
import { buildTopicsTemplate } from './temas-excel.template.js';

@ApiTags('Importaciones')
@ApiBearerAuth('bearer')
@ApiForbiddenResponse({ description: 'Solo ADMIN puede importar temas.' })
@Controller('importaciones/temas')
@Roles(UsuarioRol.ADMIN)
export class ImportacionesTemasController {
  constructor(private readonly service: ImportacionesTemasService) {}

  @Get('plantilla')
  @ApiOperation({ summary: 'Descargar la plantilla XLSX de temas' })
  @ApiOkResponse({ description: 'Libro XLSX con los encabezados Nro., Docente, Temas, Carrera y Observación en la fila 1.' })
  async downloadTemplate(@Res() response: Response): Promise<void> {
    const bytes = await buildTopicsTemplate();
    response.setHeader('Content-Type', XLSX_MIME);
    response.setHeader('Content-Disposition', 'attachment; filename="plantilla-temas-titulacion.xlsx"');
    response.setHeader('Cache-Control', 'no-store');
    response.send(Buffer.from(bytes));
  }

  @Post('validar')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('archivo', XLSX_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['archivo', 'carrera_id', 'linea_id', 'tipo'], properties: { archivo: { type: 'string', format: 'binary' }, carrera_id: { type: 'string', format: 'uuid' }, linea_id: { type: 'string', format: 'uuid' }, tipo: { type: 'string', enum: ['INDIVIDUAL', 'PAREJA', 'GRUPO'] } } } })
  @ApiOperation({ summary: 'Validar un XLSX de temas y devolver la vista previa con el emparejamiento de docentes' })
  @ApiOkResponse({ description: 'Preparación con filas LISTA, PENDIENTE_DOCENTE, DUPLICADA o ERROR.' })
  @ApiBadRequestResponse({ description: 'Archivo ausente o inválido, carrera inexistente o parámetros faltantes.' })
  @ApiNotFoundResponse({ description: 'No existe la línea de investigación.' })
  @ApiConflictResponse({ description: 'La línea de investigación está inactiva.' })
  validar(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: ValidarImportacionTemasDto,
    @CurrentUsuario() actor: Usuario,
    @Req() request: Request,
  ) {
    if (!file) throw new BadRequestException('Adjunta un archivo XLSX en el campo archivo.');
    return this.service.validar(actor, file.originalname, file.buffer, request.ip ?? null, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar la vista previa de una importación de temas' })
  @ApiOkResponse({ description: 'Detalle de la preparación.' })
  @ApiNotFoundResponse({ description: 'No existe la preparación de temas.' })
  @ApiGoneResponse({ description: 'La preparación venció.' })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(id);
  }

  @Patch(':id/docentes')
  @ApiOperation({ summary: 'Asignar el docente de las filas pendientes (se aplica a todas las filas con ese nombre del Excel)' })
  @ApiOkResponse({ description: 'Vista previa actualizada.' })
  @ApiBadRequestResponse({ description: 'Resoluciones inválidas, nombre sin filas o docente fuera de la carrera.' })
  @ApiNotFoundResponse({ description: 'No existe la preparación de temas.' })
  @ApiConflictResponse({ description: 'La preparación tiene errores o ya se completó.' })
  @ApiGoneResponse({ description: 'La preparación venció.' })
  resolverDocentes(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ResolverDocentesImportacionDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.service.resolverDocentes(id, dto, actor, request.ip ?? null);
  }

  @Post(':id/confirmar')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: ConfirmarImportacionDto })
  @ApiOperation({ summary: 'Crear en una transacción los temas PUBLICADOS de una vista previa sin errores ni docentes pendientes' })
  @ApiOkResponse({ description: 'Lote de importación TEMAS con temas creados y duplicados omitidos.' })
  @ApiNotFoundResponse({ description: 'No existe la preparación de temas.' })
  @ApiConflictResponse({ description: 'Hay errores o docentes pendientes, la línea o un docente ya no está activo, o ya se completó.' })
  @ApiGoneResponse({ description: 'La preparación venció.' })
  confirmar(@Param('id', new ParseUUIDPipe()) id: string, @Body() _body: ConfirmarImportacionDto, @CurrentUsuario() actor: Usuario, @Req() request: Request) {
    return this.service.confirmar(id, actor, request.ip ?? null);
  }
}
