import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { AsignacionTemaEstado } from '../../asignaciones-tema/enums/asignacion-tema-estado.enum.js';

export class ListEquiposQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AsignacionTemaEstado })
  @IsOptional()
  @IsEnum(AsignacionTemaEstado)
  estado?: AsignacionTemaEstado;
}
