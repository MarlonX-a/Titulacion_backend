import { ApiProperty } from '@nestjs/swagger';
import { AsignacionTemaEstado } from '../enums/asignacion-tema-estado.enum.js';
import { AsignacionTemaCausa } from '../enums/asignacion-tema-causa.enum.js';

export class AsignacionTemaResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) periodo_id: string;
  @ApiProperty({ format: 'uuid' }) tema_id: string;
  @ApiProperty({ type: Object }) tema: { id: string; titulo: string; estado: string };
  @ApiProperty({ format: 'uuid' }) postulacion_id: string;
  @ApiProperty({ type: Object }) postulacion: { id: string; estado: string; modalidad: string; num_integrantes: number };
  @ApiProperty({ nullable: true, format: 'uuid' }) grupo_id: string | null;
  @ApiProperty({ type: Object, nullable: true }) grupo: { id: string; nombre: string } | null;
  @ApiProperty({ nullable: true, format: 'uuid' }) estudiante_id: string | null;
  @ApiProperty({ type: [Object] }) participantes: Array<{ id: string; nombres: string; apellidos: string; matricula: string; situacion_ingreso: string | null }>;
  @ApiProperty({ format: 'uuid' }) aprobada_por_id: string;
  @ApiProperty({ type: Object }) aprobada_por: { id: string; nombres: string; apellidos: string };
  @ApiProperty({ enum: AsignacionTemaEstado }) estado: AsignacionTemaEstado;
  @ApiProperty({ type: String, format: 'date-time' }) fecha_asignacion: Date;
  @ApiProperty() motivo: string;
  @ApiProperty({ enum: AsignacionTemaCausa, nullable: true }) causa_anulacion: AsignacionTemaCausa | null;
  @ApiProperty({ nullable: true }) motivo_anulacion: string | null;
  @ApiProperty({ nullable: true, format: 'uuid' }) anulada_por_id: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) fecha_anulacion: Date | null;
}

export class PagedAsignacionesTemaResponseDto {
  @ApiProperty({ type: [AsignacionTemaResponseDto] }) data: AsignacionTemaResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
