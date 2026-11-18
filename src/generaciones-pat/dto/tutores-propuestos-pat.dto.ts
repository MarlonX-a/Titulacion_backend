import { ApiProperty } from '@nestjs/swagger';

export class TutorVigentePatDto {
  @ApiProperty({ format: 'uuid' }) docente_id: string;
  @ApiProperty() nombres: string;
  @ApiProperty() apellidos: string;
}

export class TutorPropuestoPatDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() orden_prioridad: number;
  @ApiProperty({ format: 'uuid' }) docente_id: string;
  @ApiProperty() nombres: string;
  @ApiProperty() apellidos: string;
  @ApiProperty() elegible_actualmente: boolean;
  @ApiProperty() es_proponente_tema: boolean;
}

export class TutoresPropuestosPatResponseDto {
  @ApiProperty({ type: TutorVigentePatDto, nullable: true }) tutor_vigente: TutorVigentePatDto | null;
  @ApiProperty({ type: [TutorPropuestoPatDto] }) data: TutorPropuestoPatDto[];
}
