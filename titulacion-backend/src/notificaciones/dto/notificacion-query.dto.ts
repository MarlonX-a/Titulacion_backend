import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { NotificacionCanal } from '../enums/notificacion-canal.enum.js';

export enum NotificacionTipo { PAT_ENTREGADO = 'PAT_ENTREGADO', PAT_REVISADO = 'PAT_REVISADO' }
export class NotificacionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['PAT_ENTREGADO', 'PAT_REVISADO'] })
  @IsOptional() @IsEnum(NotificacionTipo) tipo?: NotificacionTipo;
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional() @Transform(({ value }: { value: unknown }) => value === 'true' ? true : value === 'false' ? false : value) @IsBoolean() leida?: boolean;
}

export { NotificacionCanal };
