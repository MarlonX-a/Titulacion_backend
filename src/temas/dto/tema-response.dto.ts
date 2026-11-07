import { ApiProperty } from '@nestjs/swagger';
import { CarreraResumenDto } from '../../academico/dto/resumen-academico.dto.js';
import { EstadoTema } from '../enums/estado-tema.enum.js';
import { TipoTema } from '../enums/tipo-tema.enum.js';

export class TemaResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) carrera_id: string;
  @ApiProperty({ type: () => CarreraResumenDto }) carrera: CarreraResumenDto;
  @ApiProperty({ format: 'uuid' }) linea_id: string;
  @ApiProperty() linea: { id: string; codigo: string; nombre: string };
  @ApiProperty({ format: 'uuid' }) docente_proponente_id: string;
  @ApiProperty() docente_proponente: { id: string; nombres: string; apellidos: string };
  @ApiProperty({ maxLength: 250 }) titulo: string;
  @ApiProperty() descripcion: string;
  @ApiProperty({ enum: TipoTema }) tipo: TipoTema;
  @ApiProperty({ description: 'Minimum members derived from tipo.' }) min_integrantes: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Maximum members; for GRUPO it is the max_integrantes_default of periodo_id (null without periodo_id).' }) max_integrantes: number | null;
  @ApiProperty({ enum: EstadoTema }) estado: EstadoTema;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) lote_importacion_id: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) creado_en: Date;
  @ApiProperty({ description: 'True when the topic is PUBLICADO and has no VIGENTE assignment.' }) disponible: boolean;
  @ApiProperty({ description: 'PENDIENTE and EN_CONFLICTO applications (of periodo_id when given, else of every period).' }) postulaciones_abiertas: number;
}
