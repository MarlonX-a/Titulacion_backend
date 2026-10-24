import { IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export enum EstadoConsultaConflicto { SIN_RESOLVER = 'SIN_RESOLVER', RESUELTO = 'RESUELTO' }

export class ListConflictosQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: EstadoConsultaConflicto })
  @IsOptional() @IsEnum(EstadoConsultaConflicto) estado?: EstadoConsultaConflicto;
}
