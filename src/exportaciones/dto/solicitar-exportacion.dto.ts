import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsObject, ValidateIf } from 'class-validator';
import { ExportacionFormato } from '../enums/exportacion-formato.enum.js';
import { ExportacionTipo } from '../enums/exportacion-tipo.enum.js';

export class SolicitarExportacionDto {
  @ApiProperty({ enum: ExportacionTipo })
  @IsEnum(ExportacionTipo)
  tipo_reporte: ExportacionTipo;

  @ApiProperty({ enum: ExportacionFormato })
  @IsEnum(ExportacionFormato)
  formato: ExportacionFormato;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsObject()
  filtros: Record<string, unknown> = {};
}
