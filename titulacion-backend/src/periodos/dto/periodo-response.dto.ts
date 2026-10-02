import { ApiProperty } from '@nestjs/swagger';
import { PeriodoEstado } from '../enums/periodo-estado.enum.js';

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
}
