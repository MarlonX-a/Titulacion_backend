import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { CarreraResumenDto } from '../../academico/dto/resumen-academico.dto.js';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;
const supplied = (_object: object, value: unknown): boolean => value !== undefined;
const presente = (_object: object, value: unknown): boolean => value !== undefined && value !== null;
/** Lee el valor crudo de la query para que "false" no se convierta en true. */
const booleano = ({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown => {
  const raw = obj[key];
  if (raw === 'true' || raw === true) return true;
  if (raw === 'false' || raw === false) return false;
  return raw;
};

export const MAX_TEMAS_PROGRAMA_DEFECTO = 15;

export class CreateProgramaDto {
  @ApiProperty({ maxLength: 150, description: 'Único por carrera (sin distinguir mayúsculas).' })
  @Transform(trim) @IsString() @Length(1, 150)
  nombre: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @ValidateIf(presente) @Transform(trim) @IsString() @Length(1, 2000)
  descripcion?: string | null;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  carrera_id: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Responsable DOCENTE (perfil docente de la misma carrera). Exactamente un responsable.' })
  @IsOptional() @IsUUID()
  responsable_docente_id?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Responsable COORDINADOR (cuenta de usuario). Para COORDINADOR se fuerza a la propia cuenta.' })
  @IsOptional() @IsUUID()
  responsable_usuario_id?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: MAX_TEMAS_PROGRAMA_DEFECTO })
  @IsOptional() @IsInt() @Min(1) @Max(50)
  max_temas?: number;
}

export class UpdateProgramaDto {
  @ApiPropertyOptional({ maxLength: 150 })
  @ValidateIf(supplied) @Transform(trim) @IsString() @Length(1, 150)
  nombre?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000, description: 'null borra la descripción.' })
  @ValidateIf(presente) @Transform(trim) @IsString() @MaxLength(2000)
  descripcion?: string | null;

  @ApiPropertyOptional({ format: 'uuid', description: 'No cambia si el programa ya tiene temas.' })
  @ValidateIf(supplied) @IsUUID()
  carrera_id?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Asignarlo quita el responsable COORDINADOR. Solo ADMIN.' })
  @ValidateIf(supplied) @IsUUID()
  responsable_docente_id?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Asignarlo quita el responsable DOCENTE. Solo ADMIN.' })
  @ValidateIf(supplied) @IsUUID()
  responsable_usuario_id?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, description: 'No puede quedar por debajo de los temas actuales.' })
  @ValidateIf(supplied) @IsInt() @Min(1) @Max(50)
  max_temas?: number;

  @ApiPropertyOptional({ description: 'false desactiva el programa (no se elimina).' })
  @ValidateIf(supplied) @IsBoolean()
  activo?: boolean;
}

export class ListProgramasQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() carrera_id?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() facultad_id?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() responsable_docente_id?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() responsable_usuario_id?: string;
  @ApiPropertyOptional({ type: Boolean, description: 'true: solo los programas de los que el usuario es responsable (COORDINADOR o DOCENTE).' })
  @IsOptional() @Transform(booleano) @IsBoolean() mios?: boolean;
  @ApiPropertyOptional({ type: Boolean, description: 'ESTUDIANTE siempre recibe solo programas activos.' })
  @IsOptional() @Transform(booleano) @IsBoolean() activo?: boolean;
}

export class ResponsableProgramaDto {
  @ApiProperty({ enum: ['DOCENTE', 'COORDINADOR'] }) tipo: 'DOCENTE' | 'COORDINADOR';
  @ApiProperty({ format: 'uuid', description: 'Id del perfil docente o de la cuenta COORDINADOR.' }) id: string;
  @ApiProperty() nombres: string;
  @ApiProperty() apellidos: string;
}

export class ProgramaResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() nombre: string;
  @ApiProperty({ type: String, nullable: true }) descripcion: string | null;
  @ApiProperty({ format: 'uuid' }) carrera_id: string;
  @ApiProperty({ type: () => CarreraResumenDto }) carrera: CarreraResumenDto;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) responsable_docente_id: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) responsable_usuario_id: string | null;
  @ApiProperty({ type: ResponsableProgramaDto }) responsable: ResponsableProgramaDto;
  @ApiProperty() max_temas: number;
  @ApiProperty({ description: 'Temas del programa que no están RETIRADOS (cuentan para max_temas).' }) temas_registrados: number;
  @ApiProperty() activo: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) creado_en: Date;
  @ApiProperty({ type: String, format: 'date-time' }) actualizado_en: Date;
}

export class PagedProgramasResponseDto {
  @ApiProperty({ type: [ProgramaResponseDto] }) data: ProgramaResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
