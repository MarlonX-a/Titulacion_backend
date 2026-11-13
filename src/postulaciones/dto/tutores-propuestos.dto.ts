import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class TutoresPropuestosInputDto {
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 5, example: ['00000000-0000-4000-8000-000000000001'] })
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(5, { message: 'Se pueden proponer como máximo 5 tutores.' }) @ArrayUnique((id: string) => id.toLowerCase()) @IsUUID('all', { each: true })
  tutores_propuestos: string[];
}

export class TutorElegibleResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() nombres: string;
  @ApiProperty() apellidos: string;
  @ApiProperty({ type: String, nullable: true }) titulo_academico: string | null;
  @ApiProperty({ format: 'uuid' }) carrera_id: string;
  @ApiProperty() es_proponente_tema: boolean;
}

export class DocenteTutorPropuestoResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() nombres: string;
  @ApiProperty() apellidos: string;
  @ApiProperty({ type: String, nullable: true }) titulo_academico: string | null;
  @ApiProperty({ format: 'uuid' }) carrera_id: string;
}

export class TutorPropuestoResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) postulacion_id: string;
  @ApiProperty({ format: 'uuid' }) docente_id: string;
  @ApiProperty() orden_prioridad: number;
  @ApiProperty({ type: DocenteTutorPropuestoResponseDto }) docente: DocenteTutorPropuestoResponseDto;
  @ApiProperty() es_proponente_tema: boolean;
  @ApiProperty() elegible_actualmente: boolean;
}

export class PagedTutorsResponseDto {
  @ApiProperty({ type: [TutorPropuestoResponseDto] }) data: TutorPropuestoResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}

export class PagedAvailableTutorsResponseDto {
  @ApiProperty({ type: [TutorElegibleResponseDto] }) data: TutorElegibleResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
