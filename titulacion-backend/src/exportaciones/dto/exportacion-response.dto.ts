import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExportacionEstado } from '../enums/exportacion-estado.enum.js';
import { ExportacionFormato } from '../enums/exportacion-formato.enum.js';
import { ExportacionTipo } from '../enums/exportacion-tipo.enum.js';

export class ExportacionResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() periodo_id: string;
  @ApiProperty({ enum: ExportacionTipo }) tipo_reporte: ExportacionTipo;
  @ApiProperty({ enum: ExportacionFormato }) formato: ExportacionFormato;
  @ApiProperty({ enum: ExportacionEstado }) estado: ExportacionEstado;
  @ApiProperty() filtros: Record<string, unknown>;
  @ApiPropertyOptional({ nullable: true }) tamano_bytes: string | null;
  @ApiPropertyOptional({ nullable: true }) hash_sha256: string | null;
  @ApiProperty() fecha_solicitud: Date;
  @ApiPropertyOptional({ nullable: true }) fecha_generacion: Date | null;
  @ApiPropertyOptional({ nullable: true }) expira_en: Date | null;
  @ApiProperty() expirada: boolean;
}

export class ExportacionPageDto {
  @ApiProperty({ type: [ExportacionResponseDto] }) data: ExportacionResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}

export class ExportacionDescargaDto {
  @ApiProperty() url: string;
  @ApiProperty() expira_en: Date;
}
