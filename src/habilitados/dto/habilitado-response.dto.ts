import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CondicionIngreso } from '../enums/condicion-ingreso.enum.js';
import { HabilitadoEstado } from '../enums/habilitado-estado.enum.js';
import { HabilitadoOrigen } from '../enums/habilitado-origen.enum.js';
import { SituacionIngreso } from '../enums/situacion-ingreso.enum.js';

export class HabilitadoEstudianteDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  nombres: string;

  @ApiProperty()
  apellidos: string;

  @ApiProperty()
  matricula: string;

  @ApiPropertyOptional({ description: 'Correo institucional. Solo en respuestas para ADMIN o el propio estudiante.' })
  email?: string;

  @ApiPropertyOptional({ description: 'Solo en respuestas para ADMIN o el propio estudiante.' })
  cedula?: string;

  @ApiPropertyOptional({ description: 'Solo en respuestas para ADMIN o el propio estudiante.' })
  carrera?: string;

  @ApiPropertyOptional({ description: 'Solo en respuestas para ADMIN o el propio estudiante.' })
  nivel?: number;
}

export class HabilitadoResponsableDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  nombres: string;

  @ApiProperty()
  apellidos: string;
}

export class HabilitadoResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  periodo_id: string;

  @ApiProperty({ format: 'uuid' })
  estudiante_id: string;

  @ApiProperty({ type: HabilitadoEstudianteDto })
  estudiante: HabilitadoEstudianteDto;

  @ApiProperty({ enum: HabilitadoOrigen })
  origen: HabilitadoOrigen;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  lote_importacion_id: string | null;

  @ApiProperty({ enum: HabilitadoEstado })
  estado: HabilitadoEstado;

  @ApiProperty({ enum: CondicionIngreso })
  condicion_ingreso: CondicionIngreso;

  @ApiPropertyOptional({ nullable: true })
  requisito_pendiente: string | null;

  @ApiProperty({ enum: SituacionIngreso })
  situacion_ingreso: SituacionIngreso;

  @ApiProperty({ type: String, format: 'date-time' })
  fecha_habilitacion: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  fecha_resolucion_ingreso: Date | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  resuelto_por_id: string | null;

  @ApiPropertyOptional({ type: HabilitadoResponsableDto, nullable: true, description: 'Responsable de la resolución del ingreso. Se omite en candidatos de invitación.' })
  resuelto_por?: HabilitadoResponsableDto | null;

  @ApiPropertyOptional({ nullable: true })
  observacion_ingreso: string | null;
}
