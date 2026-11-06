import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Validate } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CedulaEcuatorianaValidator } from '../../common/validators/cedula-ecuatoriana.validator.js';

/** Los datos opcionales del perfil vacíos se guardan como NULL. */
function optionalText(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Datos opcionales del perfil docente, compartidos por el alta y la edición. */
export abstract class DocentePerfilOpcionalDto {
  @ApiPropertyOptional({ example: '0102030400', maxLength: 20, nullable: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalText(value))
  @IsString()
  @Validate(CedulaEcuatorianaValidator)
  cedula?: string | null;

  @ApiPropertyOptional({ maxLength: 120, nullable: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalText(value))
  @IsString()
  @Length(1, 120)
  titulo_academico?: string | null;

  @ApiPropertyOptional({ maxLength: 120, nullable: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalText(value))
  @IsString()
  @Length(1, 120)
  departamento?: string | null;
}
