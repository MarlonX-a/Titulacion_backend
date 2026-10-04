import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { EstadoTema } from '../enums/estado-tema.enum.js';

export class ListTemasQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  linea_id?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  docente_proponente_id?: string;

  @ApiPropertyOptional({ enum: EstadoTema })
  @IsOptional()
  @IsEnum(EstadoTema)
  estado?: EstadoTema;

  @ApiPropertyOptional({ minimum: 1, maximum: 32767, type: Number, description: 'Filtra temas cuyo rango de integrantes incluye esta cantidad.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(32767)
  num_integrantes?: number;
}
