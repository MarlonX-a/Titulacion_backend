import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiAcceptedResponse, ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConflictResponse, ApiConsumes, ApiForbiddenResponse, ApiGoneResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import 'multer';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { Roles } from '../common/roles.decorator.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { ConfirmarImportacionDto } from './confirmar-importacion.dto.js';
import { buildTeachersTemplate } from './docentes-excel.template.js';
import { ImportacionesDocentesService } from './importaciones-docentes.service.js';
import { XLSX_MIME, XLSX_UPLOAD_OPTIONS } from './importaciones.controller.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { ImportacionHistorialPageDto } from './dto/importacion-historial.dto.js';
import { ImportacionesHistorialService } from './importaciones-historial.service.js';

@ApiTags('Importaciones')
@ApiBearerAuth('bearer')
@ApiForbiddenResponse({ description: 'Solo ADMIN puede importar docentes.' })
@Controller('importaciones/docentes')
@Roles(UsuarioRol.ADMIN)
export class ImportacionesDocentesController {
  constructor(private readonly service: ImportacionesDocentesService, private readonly historial: ImportacionesHistorialService) {}

  @Get()
  @ApiOperation({ summary: 'Historial de importaciones de docentes (más recientes primero)', description: 'Incluye preparaciones vencidas (expirada = true) y el lote cuando la importación se completó.' })
  @ApiOkResponse({ type: ImportacionHistorialPageDto })
  @ApiBadRequestResponse({ description: 'Paginación inválida.' })
  listHistorial(@Query() query: PaginationQueryDto) {
    return this.historial.listarDocentes(query);
  }

  @Get('plantilla')
  @ApiOperation({ summary: 'Descargar la plantilla XLSX de docentes' })
  @ApiOkResponse({ description: 'Libro XLSX con encabezados en la fila 4: cedula, nombres, apellidos, email, titulo, departamento, habilitado_tutoria (SI/NO).' })
  async downloadTemplate(@Res() response: Response): Promise<void> {
    const bytes = await buildTeachersTemplate();
    response.setHeader('Content-Type', XLSX_MIME);
    response.setHeader('Content-Disposition', 'attachment; filename="plantilla-docentes-titulacion.xlsx"');
    response.setHeader('Cache-Control', 'no-store');
    response.send(Buffer.from(bytes));
  }

  @Post('validar')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('archivo', XLSX_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['archivo'], properties: { archivo: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Validar un XLSX de docentes y generar una vista previa sin crear cuentas (no depende de un período)' })
  @ApiAcceptedResponse({ description: 'Validación en segundo plano; consultar la preparación.' })
  @ApiBadRequestResponse({ description: 'Archivo ausente, no XLSX o fuera de los límites.' })
  submit(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUsuario() actor: Usuario,
    @Req() request: Request,
  ) {
    if (!file) throw new BadRequestException('Adjunta un archivo XLSX en el campo archivo.');
    return this.service.submit(actor, file.originalname, file.buffer, request.ip ?? null);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar progreso, errores por fila y vista previa de la importación de docentes' })
  @ApiOkResponse({ description: 'Detalle de la preparación.' })
  @ApiNotFoundResponse({ description: 'No existe la preparación de docentes.' })
  @ApiGoneResponse({ description: 'La preparación venció.' })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(id);
  }

  @Post(':id/confirmar')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBody({ type: ConfirmarImportacionDto })
  @ApiOperation({ summary: 'Confirmar e importar docentes de una vista previa sin errores' })
  @ApiAcceptedResponse({ description: 'Importación aceptada para ejecución en segundo plano.' })
  @ApiNotFoundResponse({ description: 'No existe la preparación de docentes.' })
  @ApiConflictResponse({ description: 'La vista previa tiene errores, venció o ya se completó.' })
  confirm(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() _body: ConfirmarImportacionDto,
    @CurrentUsuario() actor: Usuario,
    @Req() request: Request,
  ) {
    return this.service.confirm(id, actor, request.ip ?? null);
  }
}
