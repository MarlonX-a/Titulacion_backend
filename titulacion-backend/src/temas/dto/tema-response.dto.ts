import { ApiProperty } from '@nestjs/swagger';
import { EstadoTema } from '../enums/estado-tema.enum.js';

export class TemaResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) periodo_id: string;
  @ApiProperty({ format: 'uuid' }) linea_id: string;
  @ApiProperty() linea: { id: string; codigo: string; nombre: string };
  @ApiProperty({ format: 'uuid' }) docente_proponente_id: string;
  @ApiProperty() docente_proponente: { id: string; nombres: string; apellidos: string };
  @ApiProperty({ maxLength: 250 }) titulo: string;
  @ApiProperty() descripcion: string;
  @ApiProperty() min_integrantes: number;
  @ApiProperty() max_integrantes: number;
  @ApiProperty({ enum: EstadoTema }) estado: EstadoTema;
  @ApiProperty({ type: String, format: 'date-time' }) creado_en: Date;
}
