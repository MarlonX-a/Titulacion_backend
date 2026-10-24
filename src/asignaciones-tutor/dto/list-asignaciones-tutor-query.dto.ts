import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { AsignacionTutorEstado } from '../enums/asignacion-tutor-estado.enum.js';
import { AsignacionTutorTipo } from '../enums/asignacion-tutor-tipo.enum.js';

export class ListAsignacionesTutorQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AsignacionTutorEstado })
  @IsOptional() @IsEnum(AsignacionTutorEstado)
  estado?: AsignacionTutorEstado;

  @ApiPropertyOptional({ enum: AsignacionTutorTipo })
  @IsOptional() @IsEnum(AsignacionTutorTipo)
  tipo?: AsignacionTutorTipo;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  asignacion_tema_id?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Solo disponible para ADMIN.' })
  @IsOptional() @IsUUID()
  docente_id?: string;
}
