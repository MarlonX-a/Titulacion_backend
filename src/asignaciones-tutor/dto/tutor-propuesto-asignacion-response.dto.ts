import { ApiProperty } from '@nestjs/swagger';

export class TutorPropuestoAsignacionResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) docente_id: string;
  @ApiProperty() orden_prioridad: number;
  @ApiProperty() es_proponente_tema: boolean;
  @ApiProperty() elegible_actualmente: boolean;
  @ApiProperty({ type: Object }) docente: {
    id: string; nombres: string; apellidos: string; titulo_academico: string | null; carrera_id: string;
  };
}

export class PagedTutorPropuestoAsignacionResponseDto {
  @ApiProperty({ type: [TutorPropuestoAsignacionResponseDto] }) data: TutorPropuestoAsignacionResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
