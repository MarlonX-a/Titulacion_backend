import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

export class AsignarTutorCandidatoDto {
  @ApiProperty({ format: 'uuid', description: 'Candidato del equipo que queda como tutor vigente.' })
  @IsUUID()
  candidato_id: string;

  @ApiPropertyOptional({ maxLength: 1000, description: 'Obligatorio solo si el equipo ya tiene tutor vigente (se reemplaza conservando el historial).' })
  @IsOptional() @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 1000) @Matches(/\S/, { message: 'El motivo no puede estar vacío.' })
  motivo?: string;
}
