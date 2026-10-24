import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { AsignacionTemaEstado } from '../enums/asignacion-tema-estado.enum.js';

export class ListAsignacionesTemaQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AsignacionTemaEstado })
  @IsOptional()
  @IsEnum(AsignacionTemaEstado)
  estado?: AsignacionTemaEstado;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  tema_id?: string;

  @ApiPropertyOptional({ enum: ['INDIVIDUAL', 'GRUPAL'] })
  @IsOptional()
  @IsEnum(['INDIVIDUAL', 'GRUPAL'])
  modalidad?: 'INDIVIDUAL' | 'GRUPAL';
}
