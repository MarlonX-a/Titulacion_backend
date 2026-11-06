import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PeriodoEstado } from '../enums/periodo-estado.enum.js';
import { FacultadResumenDto } from '../../academico/dto/resumen-academico.dto.js';

export class PeriodoResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ maxLength: 20 })
  codigo: string;

  @ApiProperty({ maxLength: 120 })
  nombre: string;

  @ApiProperty({ type: String, format: 'date-time' })
  fecha_inicio_postulacion: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  fecha_fin_postulacion: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  fecha_inicio_titulacion: Date;

  @ApiProperty({ enum: PeriodoEstado })
  estado: PeriodoEstado;

  @ApiProperty({ minimum: 1, maximum: 32767 })
  max_integrantes_default: number;

  @ApiProperty({ format: 'uuid' })
  facultad_id: string;

  @ApiProperty({ type: () => FacultadResumenDto })
  facultad: FacultadResumenDto;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Habilitaciones CONDICIONADO con ingreso PENDIENTE. Solo se incluye en GET /periodos y GET /periodos/:id para ADMIN.',
  })
  condicionados_pendientes?: number;
}
