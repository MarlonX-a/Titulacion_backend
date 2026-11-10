import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsString, IsUUID, Length, ValidateIf } from 'class-validator';
import { TipoTema } from '../enums/tipo-tema.enum.js';

const supplied = (_object: object, value: unknown): boolean => value !== undefined;
const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;

export class UpdateTemaDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Debe coincidir con la carrera del docente proponente; no cambia con postulaciones abiertas.' })
  @ValidateIf(supplied)
  @IsUUID()
  carrera_id?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf(supplied)
  @IsUUID()
  linea_id?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf(supplied)
  @IsUUID()
  docente_proponente_id?: string;

  @ApiPropertyOptional({ enum: TipoTema, description: 'No cambia con postulaciones abiertas.' })
  @ValidateIf(supplied)
  @IsEnum(TipoTema)
  tipo?: TipoTema;

  @ApiPropertyOptional({ maxLength: 250 })
  @ValidateIf(supplied)
  @Transform(trim)
  @IsString()
  @Length(1, 250)
  titulo?: string;

  @ApiPropertyOptional({ maxLength: 20_000 })
  @ValidateIf(supplied)
  @Transform(trim)
  @IsString()
  @Length(1, 20_000)
  descripcion?: string;
}
