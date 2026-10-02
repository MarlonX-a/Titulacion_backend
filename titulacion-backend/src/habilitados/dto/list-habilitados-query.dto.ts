import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { CondicionIngreso } from '../enums/condicion-ingreso.enum.js';
import { HabilitadoEstado } from '../enums/habilitado-estado.enum.js';
import { SituacionIngreso } from '../enums/situacion-ingreso.enum.js';

export class ListHabilitadosQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CondicionIngreso })
  @IsOptional()
  @IsEnum(CondicionIngreso)
  condicion_ingreso?: CondicionIngreso;

  @ApiPropertyOptional({ enum: SituacionIngreso })
  @IsOptional()
  @IsEnum(SituacionIngreso)
  situacion_ingreso?: SituacionIngreso;

  @ApiPropertyOptional({ enum: HabilitadoEstado })
  @IsOptional()
  @IsEnum(HabilitadoEstado)
  estado?: HabilitadoEstado;
}
