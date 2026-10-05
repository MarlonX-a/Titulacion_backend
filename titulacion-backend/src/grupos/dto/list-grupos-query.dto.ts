import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { GrupoEstado } from '../enums/grupo-estado.enum.js';

export class ListGruposQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: GrupoEstado })
  @IsOptional()
  @IsEnum(GrupoEstado)
  estado?: GrupoEstado;
}
