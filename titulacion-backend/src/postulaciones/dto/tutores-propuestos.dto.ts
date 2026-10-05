import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class TutoresPropuestosInputDto {
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 32767, example: ['00000000-0000-4000-8000-000000000001'] })
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(32767) @ArrayUnique((id: string) => id.toLowerCase()) @IsUUID('all', { each: true })
  tutores_propuestos: string[];
}

export class TutorElegibleResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() nombres: string;
  @ApiProperty() apellidos: string;
  @ApiProperty() titulo_academico: string;
  @ApiProperty() departamento: string;
  @ApiProperty() es_proponente_tema: boolean;
}

export class DocenteTutorPropuestoResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() nombres: string;
  @ApiProperty() apellidos: string;
  @ApiProperty() titulo_academico: string;
  @ApiProperty() departamento: string;
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
