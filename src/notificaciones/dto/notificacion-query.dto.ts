import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { NotificacionCanal, NotificacionTipo } from '../enums/notificacion-canal.enum.js';

export class NotificacionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: NotificacionTipo })
  @IsOptional() @IsEnum(NotificacionTipo) tipo?: NotificacionTipo;
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional() @Transform(({ value }: { value: unknown }) => value === 'true' ? true : value === 'false' ? false : value) @IsBoolean() leida?: boolean;
}

export { NotificacionCanal, NotificacionTipo };
