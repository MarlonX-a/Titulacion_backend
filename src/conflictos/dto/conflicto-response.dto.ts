import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CriterioConflicto } from '../enums/criterio-conflicto.enum.js';
import { EstadoConsultaConflicto } from './list-conflictos-query.dto.js';
import { EstadoTema } from '../../temas/enums/estado-tema.enum.js';
import { EstadoPostulacion } from '../../postulaciones/enums/estado-postulacion.enum.js';

export class ConflictoTemaResumenDto {
  @ApiProperty({ format: 'uuid' }) tema_id!: string;
  @ApiProperty() titulo!: string;
  @ApiProperty({ enum: EstadoTema }) estado_tema!: EstadoTema;
  @ApiProperty() min_integrantes!: number;
  @ApiProperty() max_integrantes!: number;
  @ApiProperty() cantidad_postulaciones_elegibles!: number;
  @ApiPropertyOptional({ enum: EstadoConsultaConflicto, nullable: true }) estado_conflicto!: EstadoConsultaConflicto | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) resolucion_id!: string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) postulacion_ganadora_id!: string | null;
}

export class ConflictoPostulanteResumenDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() nombres!: string;
  @ApiProperty() apellidos!: string;
  @ApiProperty() matricula!: string;
}

export class ConflictoPostulacionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: EstadoPostulacion }) estado!: EstadoPostulacion;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) grupo_id!: string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) estudiante_id!: string | null;
  @ApiProperty() num_integrantes!: number;
  @ApiProperty() fecha_postulacion!: Date;
  @ApiProperty() elegible!: boolean;
  @ApiPropertyOptional({ nullable: true }) motivo!: string | null;
  @ApiProperty({ type: [ConflictoPostulanteResumenDto] }) participantes!: ConflictoPostulanteResumenDto[];
}

export class ConflictoResolucionParticipanteDto {
  @ApiProperty({ format: 'uuid' }) postulacion_id!: string;
  @ApiPropertyOptional({ type: Number, nullable: true }) puntaje_criterio!: number | null;
}

export class ConflictoResponsableDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() nombres!: string;
  @ApiProperty() apellidos!: string;
}

export class ConflictoResolucionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: CriterioConflicto }) criterio_aplicado!: CriterioConflicto;
  @ApiProperty({ format: 'uuid' }) postulacion_ganadora_id!: string;
  @ApiProperty() justificacion!: string;
  @ApiProperty() fecha_resolucion!: Date;
  @ApiProperty({ type: ConflictoResponsableDto }) responsable!: ConflictoResponsableDto;
  @ApiProperty({ type: [ConflictoResolucionParticipanteDto] }) participantes!: ConflictoResolucionParticipanteDto[];
}

export class ConflictoDetalleResponseDto {
  @ApiProperty({ format: 'uuid' }) periodo_id!: string;
  @ApiProperty({ type: ConflictoTemaResumenDto }) tema!: ConflictoTemaResumenDto;
  @ApiProperty() elegibles!: number;
  @ApiPropertyOptional({ type: ConflictoResolucionDto, nullable: true }) resolucion!: ConflictoResolucionDto | null;
  @ApiProperty({ type: [ConflictoPostulacionDto] }) postulaciones!: ConflictoPostulacionDto[];
}

export class ConflictosPageResponseDto {
  @ApiProperty({ type: [ConflictoTemaResumenDto] }) data!: ConflictoTemaResumenDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
