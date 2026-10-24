import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { InvitacionEstado } from '../enums/invitacion-estado.enum.js';

export class ListInvitacionesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: InvitacionEstado })
  @IsOptional()
  @IsEnum(InvitacionEstado)
  estado?: InvitacionEstado;
}
