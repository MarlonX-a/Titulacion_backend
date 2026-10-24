import { ApiProperty } from '@nestjs/swagger';
import { AsignacionTutorEstado } from '../enums/asignacion-tutor-estado.enum.js';
import { AsignacionTutorTipo } from '../enums/asignacion-tutor-tipo.enum.js';

export class ParticipanteTutorResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() nombres: string;
  @ApiProperty() apellidos: string;
  @ApiProperty() matricula: string;
}

export class AsignacionTutorResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) periodo_id: string;
  @ApiProperty({ format: 'uuid' }) asignacion_tema_id: string;
  @ApiProperty({ format: 'uuid' }) docente_id: string;
  @ApiProperty({ format: 'uuid', nullable: true }) tutor_propuesto_id: string | null;
  @ApiProperty({ enum: AsignacionTutorTipo }) tipo: AsignacionTutorTipo;
  @ApiProperty({ enum: AsignacionTutorEstado }) estado: AsignacionTutorEstado;
  @ApiProperty({ format: 'uuid' }) asignada_por_id: string;
  @ApiProperty() fecha_asignacion: Date;
  @ApiProperty({ nullable: true }) fecha_fin: Date | null;
  @ApiProperty({ nullable: true }) motivo_cambio: string | null;
  @ApiProperty({ type: Object }) docente: { id: string; nombres: string; apellidos: string; titulo_academico: string; departamento: string };
  @ApiProperty({ type: Object }) responsable: { id: string; nombres: string; apellidos: string };
  @ApiProperty({ type: Object }) trabajo: {
    id: string;
    tema: { id: string; titulo: string };
    postulacion: { id: string; modalidad: 'INDIVIDUAL' | 'GRUPAL'; num_integrantes: number };
    grupo: { id: string; nombre: string } | null;
    participantes: ParticipanteTutorResponseDto[];
  };
}

export class PagedAsignacionTutorResponseDto {
  @ApiProperty({ type: [AsignacionTutorResponseDto] }) data: AsignacionTutorResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}

export class CargaTutorActualResponseDto {
  @ApiProperty({ format: 'uuid' }) periodo_id: string;
  @ApiProperty({ format: 'uuid' }) docente_id: string;
  @ApiProperty() carga_actual: number;
  @ApiProperty({ nullable: true }) excede_limite: boolean | null;
  @ApiProperty({ enum: ['DOCENTE', 'GLOBAL', 'SIN_CONFIGURACION'] }) origen: 'DOCENTE' | 'GLOBAL' | 'SIN_CONFIGURACION';
  @ApiProperty({ type: Object, nullable: true }) configuracion: {
    id: string; max_trabajos: number; bloquear_al_superar: boolean;
  } | null;
}

export class CargaProyectadaResponseDto {
  @ApiProperty() actual: number;
  @ApiProperty() proyectada: number;
  @ApiProperty() excede_limite: boolean;
  @ApiProperty({ enum: ['DOCENTE', 'GLOBAL'] }) origen: 'DOCENTE' | 'GLOBAL';
  @ApiProperty({ type: Object }) configuracion: {
    id: string; max_trabajos: number; bloquear_al_superar: boolean;
  };
}

export class ResultadoAsignacionTutorResponseDto {
  @ApiProperty({ type: AsignacionTutorResponseDto }) asignacion: AsignacionTutorResponseDto;
  @ApiProperty({ type: CargaProyectadaResponseDto }) carga: CargaProyectadaResponseDto;
  @ApiProperty({ type: [String] }) advertencias: string[];
}
