import { ApiProperty } from '@nestjs/swagger';
import { AsignacionTemaEstado } from '../../asignaciones-tema/enums/asignacion-tema-estado.enum.js';
import { AsignacionTemaOrigen } from '../../asignaciones-tema/enums/asignacion-tema-origen.enum.js';
import { AsignacionTutorTipo } from '../../asignaciones-tutor/enums/asignacion-tutor-tipo.enum.js';

export class DocenteEquipoDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() nombres: string;
  @ApiProperty() apellidos: string;
  @ApiProperty({ type: String, nullable: true }) titulo_academico: string | null;
}

export class CargaCandidatoDto {
  @ApiProperty() actual: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Límite efectivo; nulo si el período no tiene configuración aplicable.' }) max_trabajos: number | null;
  @ApiProperty({ type: Boolean, nullable: true }) bloquear_al_superar: boolean | null;
}

export class CandidatoTutorDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ minimum: 1, maximum: 10 }) prioridad: number;
  @ApiProperty({ type: DocenteEquipoDto }) docente: DocenteEquipoDto;
  @ApiProperty({ description: 'Cuenta activa, rol DOCENTE y habilitación para tutoría vigentes.' }) elegible_actualmente: boolean;
  @ApiProperty({ type: CargaCandidatoDto }) carga: CargaCandidatoDto;
}

export class TutorVigenteEquipoDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: AsignacionTutorTipo }) tipo: AsignacionTutorTipo;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) candidato_tutor_id: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) fecha_asignacion: Date;
  @ApiProperty({ type: DocenteEquipoDto }) docente: DocenteEquipoDto;
}

/** Estado PAT individual del integrante. La carga inversa del Word (pieza B) se apoya en esta sección. */
export class PatIntegranteDto {
  @ApiProperty({ description: 'El estudiante tiene datos personales complementarios guardados.' }) datos_personales_registrados: boolean;
  @ApiProperty({ description: 'Existe contenido PAT del estudiante para este trabajo.' }) contenido_registrado: boolean;
  @ApiProperty({ type: Object, nullable: true, description: 'Última generación del PAT (EN_COLA, PROCESANDO, LISTO o FALLIDO).' }) ultima_generacion: { id: string; estado: string; solicitada_en: Date } | null;
  @ApiProperty({ type: Object, nullable: true, description: 'Última versión entregada y el resultado de su revisión, si existe.' }) ultima_entrega: { id: string; version: number; fecha_carga: Date; revision: string | null } | null;
}

export class IntegranteEquipoDto {
  @ApiProperty({ format: 'uuid' }) estudiante_id: string;
  @ApiProperty() nombres: string;
  @ApiProperty() apellidos: string;
  @ApiProperty() matricula: string;
  @ApiProperty({ type: String, nullable: true, enum: ['REPRESENTANTE', 'INTEGRANTE'] }) rol_en_grupo: string | null;
  @ApiProperty({ type: String, nullable: true }) situacion_ingreso: string | null;
  @ApiProperty({ type: PatIntegranteDto }) pat: PatIntegranteDto;
}

export class EquipoResponseDto {
  @ApiProperty({ format: 'uuid', description: 'Identificador de la asignación de tema del equipo.' }) id: string;
  @ApiProperty({ format: 'uuid' }) periodo_id: string;
  @ApiProperty({ enum: AsignacionTemaOrigen }) origen: AsignacionTemaOrigen;
  @ApiProperty({ enum: AsignacionTemaEstado }) estado: AsignacionTemaEstado;
  @ApiProperty({ enum: ['INDIVIDUAL', 'GRUPAL'] }) modalidad: 'INDIVIDUAL' | 'GRUPAL';
  @ApiProperty() motivo: string;
  @ApiProperty({ type: String, format: 'date-time' }) fecha_asignacion: Date;
  @ApiProperty({ type: Object }) tema: { id: string; titulo: string; tipo: string; estado: string };
  @ApiProperty({ type: Object, nullable: true }) grupo: { id: string; nombre: string; estado: string } | null;
  @ApiProperty({ type: [IntegranteEquipoDto] }) integrantes: IntegranteEquipoDto[];
  @ApiProperty({ type: [CandidatoTutorDto] }) candidatos: CandidatoTutorDto[];
  @ApiProperty({ type: TutorVigenteEquipoDto, nullable: true }) tutor_vigente: TutorVigenteEquipoDto | null;
}

export class ResultadoEquipoResponseDto {
  @ApiProperty({ type: EquipoResponseDto }) equipo: EquipoResponseDto;
  @ApiProperty({ type: [String], description: 'Avisos no bloqueantes (por ejemplo, carga tutorial superada en modo advertir).' }) advertencias: string[];
}

export class EquipoResumenDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: AsignacionTemaEstado }) estado: AsignacionTemaEstado;
  @ApiProperty({ enum: ['INDIVIDUAL', 'GRUPAL'] }) modalidad: 'INDIVIDUAL' | 'GRUPAL';
  @ApiProperty({ type: String, format: 'date-time' }) fecha_asignacion: Date;
  @ApiProperty({ type: Object }) tema: { id: string; titulo: string };
  @ApiProperty({ type: Object, nullable: true }) grupo: { id: string; nombre: string } | null;
  @ApiProperty({ type: [Object] }) integrantes: Array<{ estudiante_id: string; nombres: string; apellidos: string }>;
  @ApiProperty() total_candidatos: number;
  @ApiProperty({ type: Object, nullable: true }) tutor_vigente: { docente_id: string; nombres: string; apellidos: string } | null;
}

export class PagedEquiposResponseDto {
  @ApiProperty({ type: [EquipoResumenDto] }) data: EquipoResumenDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
