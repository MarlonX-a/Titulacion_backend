import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
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
}
