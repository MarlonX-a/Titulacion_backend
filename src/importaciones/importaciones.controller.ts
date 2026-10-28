import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiAcceptedResponse, ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiConsumes, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import 'multer';
import { CurrentUsuario } from '../usuarios/current-usuario.decorator.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { Roles } from '../common/roles.decorator.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { ImportacionesService } from './importaciones.service.js';
import { ConfirmarImportacionDto } from './confirmar-importacion.dto.js';
import { buildStudentsTemplate } from './estudiantes-excel.template.js';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Límites compartidos para cargar libros XLSX de importación (5 MiB, un archivo). */
export const XLSX_UPLOAD_OPTIONS = {
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_request: unknown, file: Express.Multer.File, callback: (error: Error | null, accept: boolean) => void) => {
    const extension = file.originalname.toLowerCase().endsWith('.xlsx');
    const mime = file.mimetype === XLSX_MIME || file.mimetype === 'application/octet-stream';
    callback(extension && mime ? null : new BadRequestException('Adjunta un archivo .xlsx.'), extension && mime);
  },
};

@ApiTags('Importaciones')
@ApiBearerAuth('bearer')
@Controller()
@Roles(UsuarioRol.ADMIN)
export class ImportacionesController {
  constructor(private readonly service: ImportacionesService) {}

  @Get('importaciones/estudiantes/plantilla')
  @ApiOperation({ summary: 'Descargar plantilla para estudiantes habilitados' })
  @ApiOkResponse({ description: 'Libro XLSX con el formato institucional: título con "CARRERA <NOMBRE>" y encabezados en la fila 6 (#, Campus, Identificación, Apellidos, Nombres, nivel, ACADEMICO, INGLES).' })
  async downloadTemplate(@Res() response: Response): Promise<void> {
    const bytes = await buildStudentsTemplate();
    response.setHeader('Content-Type', XLSX_MIME);
    response.setHeader('Content-Disposition', 'attachment; filename="plantilla-estudiantes-titulacion.xlsx"');
    response.setHeader('Cache-Control', 'no-store');
    response.send(Buffer.from(bytes));
  }

  @Post('periodos/:periodoId/importaciones/estudiantes/validar')
  @UseInterceptors(FileInterceptor('archivo', XLSX_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['archivo'], properties: { archivo: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Validar un Excel y generar una vista previa sin crear cuentas' })
  @ApiAcceptedResponse({ description: 'Validación en segundo plano; consultar la preparación.' })
  @ApiBadRequestResponse({ description: 'Archivo inválido o fuera de los límites.' })
  async submit(
    @Param('periodoId') periodId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUsuario() actor: Usuario,
    @Req() request: Request,
  ) {
    if (!file) throw new BadRequestException('Adjunta un archivo XLSX en el campo archivo.');
    return this.service.submit(periodId, actor, file.originalname, file.buffer, request.ip ?? null);
  }

  @Get('periodos/:periodoId/importaciones/estudiantes/:id')
  @ApiOperation({ summary: 'Consultar progreso, errores y vista previa' })
  @ApiOkResponse({ description: 'Detalle de preparación accesible a ADMIN.' })
  get(@Param('periodoId') periodId: string, @Param('id') id: string) {
    return this.service.get(periodId, id);
  }

  @Post('periodos/:periodoId/importaciones/estudiantes/:id/confirmar')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBody({ type: ConfirmarImportacionDto })
  @ApiOperation({ summary: 'Confirmar e importar un archivo revisado sin errores' })
  @ApiAcceptedResponse({ description: 'Importación aceptada para ejecución en segundo plano.' })
  @ApiForbiddenResponse({ description: 'Solo ADMIN puede confirmarla.' })
  confirm(
    @Param('periodoId') periodId: string,
    @Param('id') id: string,
    @Body() _body: ConfirmarImportacionDto,
    @CurrentUsuario() actor: Usuario,
    @Req() request: Request,
  ) {
    return this.service.confirm(periodId, id, actor, request.ip ?? null);
  }
}
