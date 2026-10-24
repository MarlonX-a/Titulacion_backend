import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsISO8601,
  IsInt,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { RFC3339_WITH_ZONE } from './fechas-periodo.dto.js';

function isSupplied(_object: object, value: unknown): boolean {
  return value !== undefined;
}

function trimText(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdatePeriodoDto {
  @ApiPropertyOptional({ maxLength: 20 })
  @ValidateIf(isSupplied)
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @IsString()
  @Length(1, 20)
  codigo?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @ValidateIf(isSupplied)
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @IsString()
  @Length(1, 120)
  nombre?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-11-02T08:00:00-05:00',
  })
  @ValidateIf(isSupplied)
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(RFC3339_WITH_ZONE, {
    message: 'fecha_inicio_postulacion debe incluir hora y zona horaria explícita.',
  })
  fecha_inicio_postulacion?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-11-30T23:59:00-05:00',
  })
  @ValidateIf(isSupplied)
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(RFC3339_WITH_ZONE, {
    message: 'fecha_fin_postulacion debe incluir hora y zona horaria explícita.',
  })
  fecha_fin_postulacion?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-12-01T08:00:00-05:00',
  })
  @ValidateIf(isSupplied)
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(RFC3339_WITH_ZONE, {
    message: 'fecha_inicio_titulacion debe incluir hora y zona horaria explícita.',
  })
  fecha_inicio_titulacion?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 32767, type: Number })
  @ValidateIf(isSupplied)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(32767)
  max_integrantes_default?: number;
}
