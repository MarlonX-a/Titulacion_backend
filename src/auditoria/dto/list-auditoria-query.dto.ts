import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

/** Filtros de la consulta de auditoría (solo ADMIN). Una fecha sin hora en `hasta` cubre todo ese día UTC. */
export class ListAuditoriaQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ maxLength: 60, description: 'Tipo exacto de entidad, por ejemplo `tema`.' })
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(60)
  @Matches(/^[a-z_]+$/, { message: 'entidad_tipo solo admite minúsculas y guion bajo.' })
  entidad_tipo?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID() entidad_id?: string;

  @ApiPropertyOptional({ maxLength: 60, description: 'Acción exacta, por ejemplo `CREAR_TEMA`.' })
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(60)
  @Matches(/^[A-Z_]+$/, { message: 'accion solo admite mayúsculas y guion bajo.' })
  accion?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Usuario que ejecutó la acción.' })
  @IsOptional() @IsUUID() usuario_id?: string;

  @ApiPropertyOptional({ description: 'Fecha o instante ISO 8601 inicial (inclusive).', example: '2026-10-01' })
  @IsOptional() @IsISO8601({ strict: true, strictSeparator: true }) desde?: string;

  @ApiPropertyOptional({ description: 'Fecha o instante ISO 8601 final (inclusive; una fecha sin hora incluye todo ese día UTC).', example: '2026-10-31' })
  @IsOptional() @IsISO8601({ strict: true, strictSeparator: true }) hasta?: string;

  @ApiPropertyOptional({ maxLength: 100, description: 'Texto libre sobre acción, tipo de entidad y correo del actor (sin distinguir mayúsculas).' })
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(100) q?: string;
}
