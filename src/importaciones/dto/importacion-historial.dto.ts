import { ApiProperty } from '@nestjs/swagger';
import { LoteImportacionEstado } from '../enums/lote-importacion-estado.enum.js';
import { LoteImportacionTipo } from '../enums/lote-importacion-tipo.enum.js';
import { PreparacionImportacionEstado } from '../enums/preparacion-importacion-estado.enum.js';

export class ImportacionErrorFilaDto {
  @ApiProperty({ description: 'Fila del libro (0 = error del archivo).' }) fila: number;
  @ApiProperty() columna: string;
  @ApiProperty() mensaje: string;
}

export class ImportacionLoteResumenDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: LoteImportacionEstado }) estado: LoteImportacionEstado;
  @ApiProperty() total_filas: number;
  @ApiProperty() filas_ok: number;
  @ApiProperty() filas_error: number;
  @ApiProperty({ format: 'date-time' }) fecha_inicio: Date;
  @ApiProperty({ format: 'date-time', nullable: true, type: String }) fecha_fin: Date | null;
}

export class ImportacionSolicitanteDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() nombres: string;
  @ApiProperty() apellidos: string;
}

export class ImportacionHistorialDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: LoteImportacionTipo }) tipo: LoteImportacionTipo;
  @ApiProperty({ format: 'uuid', nullable: true, type: String }) periodo_id: string | null;
  @ApiProperty() nombre_archivo: string;
  @ApiProperty({ enum: PreparacionImportacionEstado }) estado: PreparacionImportacionEstado;
  @ApiProperty({ description: 'La vista previa venció sin completarse (VALIDANDO, LISTA o INVALIDA tras expira_en).' }) expirada: boolean;
  @ApiProperty() total_filas: number;
  @ApiProperty({ description: 'Filas importadas (lote) o filas sin errores en la vista previa.' }) filas_ok: number;
  @ApiProperty({ description: 'Filas con error (lote) o filas distintas con errores en la vista previa.' }) filas_error: number;
  @ApiProperty({ type: [ImportacionErrorFilaDto] }) errores: ImportacionErrorFilaDto[];
  @ApiProperty({ type: ImportacionLoteResumenDto, nullable: true }) lote: ImportacionLoteResumenDto | null;
  @ApiProperty({ type: ImportacionSolicitanteDto }) solicitada_por: ImportacionSolicitanteDto;
  @ApiProperty({ format: 'date-time' }) creada_en: Date;
  @ApiProperty({ format: 'date-time' }) expira_en: Date;
}

export class ImportacionHistorialPageDto {
  @ApiProperty({ type: [ImportacionHistorialDto] }) data: ImportacionHistorialDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
