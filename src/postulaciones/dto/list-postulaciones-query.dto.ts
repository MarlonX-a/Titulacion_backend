import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { EstadoPostulacion } from '../enums/estado-postulacion.enum.js';
import { ModalidadPostulacion } from '../enums/modalidad-postulacion.enum.js';

export class ListPostulacionesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() tema_id?: string;
  @ApiPropertyOptional({ enum: EstadoPostulacion }) @IsOptional() @IsEnum(EstadoPostulacion) estado?: EstadoPostulacion;
  @ApiPropertyOptional({ enum: ModalidadPostulacion }) @IsOptional() @IsEnum(ModalidadPostulacion) modalidad?: ModalidadPostulacion;
}
