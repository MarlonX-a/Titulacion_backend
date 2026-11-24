import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

const recortar = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

/** Máximo de candidatos a tutor por equipo (igual que `CHK_candidato_tutor_prioridad`). */
export const MAX_CANDIDATOS_TUTOR = 10;

export class CrearEquipoDto {
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 10, description: 'Estudiantes habilitados del período. Uno = trabajo individual; dos o más = grupo, cuyo representante es el primero de la lista.' })
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(10) @ArrayUnique((id: string) => id.toLowerCase(), { message: 'Un estudiante no puede repetirse en el equipo.' }) @IsUUID('all', { each: true })
  estudiante_ids: string[];

  @ApiProperty({ format: 'uuid', description: 'Tema PUBLICADO de la carrera de los estudiantes y sin asignación vigente.' })
  @IsUUID()
  tema_id: string;

  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: MAX_CANDIDATOS_TUTOR, description: 'Docentes candidatos a tutor en orden de prioridad. Con uno solo queda asignado como tutor vigente.' })
  @IsArray() @ArrayNotEmpty()
  @ArrayMaxSize(MAX_CANDIDATOS_TUTOR, { message: `Se pueden registrar como máximo ${MAX_CANDIDATOS_TUTOR} candidatos a tutor.` })
  @ArrayUnique((id: string) => id.toLowerCase(), { message: 'Un docente no puede repetirse entre los candidatos.' })
  @IsUUID('all', { each: true })
  docente_ids: string[];

  @ApiPropertyOptional({ maxLength: 120, description: 'Nombre del grupo (solo con dos o más estudiantes). Si se omite se genera a partir del tema.' })
  @IsOptional() @Transform(recortar) @IsString() @Length(1, 120)
  nombre_grupo?: string;

  @ApiProperty({ maxLength: 1000, example: 'Equipo conformado por la coordinación con la documentación entregada.' })
  @Transform(recortar) @IsString() @Length(1, 1000)
  @Matches(/\S/, { message: 'El motivo no puede estar vacío.' })
  motivo: string;
}
