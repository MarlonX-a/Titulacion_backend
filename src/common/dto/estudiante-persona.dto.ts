import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const MATRICULA_VISIBILIDAD = 'Solo en respuestas para ADMIN o para el propio estudiante; se omite para compañeros y docentes (en estudiantes importados equivale a la cédula).';

/** Datos de un estudiante mostrados a otros participantes del proceso. */
export class EstudiantePersonaDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() nombres: string;
  @ApiProperty() apellidos: string;
  @ApiPropertyOptional({ description: MATRICULA_VISIBILIDAD }) matricula?: string;
}
