import { IsISO8601, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export const RFC3339_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/;

export class FechasPeriodoDto {
  @ApiProperty({
    format: 'date-time',
    example: '2026-11-02T08:00:00-05:00',
    description: 'Fecha y hora ISO 8601 con zona horaria explícita.',
  })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(RFC3339_WITH_ZONE, {
    message: 'fecha_inicio_postulacion debe incluir hora y zona horaria explícita.',
  })
  fecha_inicio_postulacion: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-11-30T23:59:00-05:00',
    description: 'Debe ser posterior al inicio de postulaciones.',
  })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(RFC3339_WITH_ZONE, {
    message: 'fecha_fin_postulacion debe incluir hora y zona horaria explícita.',
  })
  fecha_fin_postulacion: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-12-01T08:00:00-05:00',
    description: 'Debe ser igual o posterior al cierre de postulaciones.',
  })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(RFC3339_WITH_ZONE, {
    message: 'fecha_inicio_titulacion debe incluir hora y zona horaria explícita.',
  })
  fecha_inicio_titulacion: string;
}
