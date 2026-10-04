import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EstadoTema } from '../enums/estado-tema.enum.js';

export class TemaHistorialResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) tema_id: string;
  @ApiProperty({ format: 'uuid' }) usuario_id: string;
  @ApiProperty() responsable: { id: string; nombres: string; apellidos: string };
  @ApiPropertyOptional({ enum: EstadoTema, nullable: true }) estado_anterior: EstadoTema | null;
  @ApiProperty({ enum: EstadoTema }) estado_nuevo: EstadoTema;
  @ApiProperty() cambios: Record<string, unknown>;
  @ApiProperty({ type: String, format: 'date-time' }) fecha: Date;
}
