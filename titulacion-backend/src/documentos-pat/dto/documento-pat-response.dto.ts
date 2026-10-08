import { ApiProperty } from '@nestjs/swagger';
import { DocumentoPatFormato } from '../enums/documento-pat-formato.enum.js';

export class DocumentoPatResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) asignacion_tema_id: string;
  @ApiProperty({ format: 'uuid' }) plantilla_id: string;
  @ApiProperty({ example: 1 }) version: number;
  @ApiProperty() nombre_archivo: string;
  @ApiProperty({ enum: DocumentoPatFormato }) formato: DocumentoPatFormato;
  @ApiProperty({ example: 204800 }) tamano_bytes: number;
  @ApiProperty({ example: 'a'.repeat(64) }) hash_sha256: string;
  @ApiProperty({ format: 'date-time' }) fecha_carga: Date;
  @ApiProperty({ enum: ['PENDIENTE'] }) revision: 'PENDIENTE';
  @ApiProperty({ type: Object }) plantilla: { id: string; version: string; nombre_archivo: string };
  @ApiProperty({ type: Object }) cargador: { id: string; nombres: string; apellidos: string };
}

export class PagedDocumentoPatResponseDto {
  @ApiProperty({ type: [DocumentoPatResponseDto] }) data: DocumentoPatResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}

export class DocumentoPatDownloadDto {
  @ApiProperty() url: string;
  @ApiProperty({ format: 'date-time' }) expira_en: Date;
}
