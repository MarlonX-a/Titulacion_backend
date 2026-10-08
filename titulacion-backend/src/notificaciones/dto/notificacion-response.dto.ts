import { ApiProperty } from '@nestjs/swagger';
import { NotificacionCanal } from '../enums/notificacion-canal.enum.js';

export class NotificacionResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['PAT_ENTREGADO', 'PAT_REVISADO'] })
  tipo: string;
  @ApiProperty()
  titulo: string;
  @ApiProperty()
  mensaje: string;
  @ApiProperty({ enum: ['documento_pat', 'revision_pat'] })
  entidad_tipo: string;
  @ApiProperty({ format: 'uuid' }) entidad_id: string;
  @ApiProperty({ enum: NotificacionCanal })
  canal: NotificacionCanal;
  @ApiProperty()
  leida: boolean;
  @ApiProperty({ format: 'date-time' })
  fecha_creacion: Date;
  @ApiProperty({ format: 'date-time', nullable: true })
  fecha_envio: Date | null;
}
export class NotificacionPageDto {
  @ApiProperty({ type: [NotificacionResponseDto] }) data: NotificacionResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
export class NotificacionCountDto { @ApiProperty() total: number }
