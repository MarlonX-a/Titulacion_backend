import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class ListDocentesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Filtra por carrera.' })
  @IsOptional()
  @IsUUID()
  carrera_id?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Filtra por facultad (combina con carrera_id mediante AND).' })
  @IsOptional()
  @IsUUID()
  facultad_id?: string;
}
