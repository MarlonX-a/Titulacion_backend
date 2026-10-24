import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { ExportacionEstado } from '../enums/exportacion-estado.enum.js';
import { ExportacionFormato } from '../enums/exportacion-formato.enum.js';
import { ExportacionTipo } from '../enums/exportacion-tipo.enum.js';

export class ListarExportacionesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ExportacionEstado }) @IsOptional() @IsEnum(ExportacionEstado) estado?: ExportacionEstado;
  @ApiPropertyOptional({ enum: ExportacionTipo }) @IsOptional() @IsEnum(ExportacionTipo) tipo_reporte?: ExportacionTipo;
  @ApiPropertyOptional({ enum: ExportacionFormato }) @IsOptional() @IsEnum(ExportacionFormato) formato?: ExportacionFormato;
}
