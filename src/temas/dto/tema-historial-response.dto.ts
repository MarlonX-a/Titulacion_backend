import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EstadoTema } from '../enums/estado-tema.enum.js';

export class TemaHistorialResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) tema_id: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Null for automatic changes (expired reservation).' }) usuario_id: string | null;
  @ApiProperty({ type: Object, nullable: true }) responsable: { id: string; nombres: string; apellidos: string } | null;
  @ApiPropertyOptional({ enum: EstadoTema, nullable: true }) estado_anterior: EstadoTema | null;
  @ApiProperty({ enum: EstadoTema }) estado_nuevo: EstadoTema;
  @ApiProperty() cambios: Record<string, unknown>;
  @ApiProperty({ type: String, format: 'date-time' }) fecha: Date;
}
