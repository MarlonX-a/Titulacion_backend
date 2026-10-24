import { IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { EntregaCorreoEstado } from '../../notificaciones/enums/entrega-correo-estado.enum.js';

export class NotificacionCorreoAdminItemDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() correo_destino: string;
  @ApiProperty() tipo: string;
  @ApiProperty() titulo: string;
  @ApiProperty({ enum: EntregaCorreoEstado }) estado: EntregaCorreoEstado;
  @ApiProperty() intentos: number;
  @ApiProperty({ format: 'date-time' }) creada_en: Date;
  @ApiProperty({ format: 'date-time' }) actualizada_en: Date;
  @ApiProperty({ nullable: true }) ultimo_error: string | null;
  @ApiProperty({ format: 'date-time', nullable: true }) enviada_en: Date | null;
}
export class NotificacionCorreoAdminPageDto {
  @ApiProperty({ type: [NotificacionCorreoAdminItemDto] }) data: NotificacionCorreoAdminItemDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}

export class NotificacionCorreoQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: EntregaCorreoEstado })
  @IsOptional() @IsEnum(EntregaCorreoEstado) estado?: EntregaCorreoEstado;
}
