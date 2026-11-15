import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface, IsEnum, Validate } from 'class-validator';
import { RevisionPatResultado } from '../enums/revision-pat-resultado.enum.js';

export const OBSERVACIONES_REVISION_MAX = 5000;

@ValidatorConstraint({ name: 'observacionesRevisionCoherentes', async: false })
class ObservacionesRevisionCoherentes implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as CrearRevisionPatDto;
    if (typeof value === 'string' && value.length > OBSERVACIONES_REVISION_MAX) return false;
    if (dto.resultado === RevisionPatResultado.APROBADO) return value === undefined || value === null || typeof value === 'string';
    return typeof value === 'string' && value.trim().length > 0;
  }

  defaultMessage(args: ValidationArguments): string {
    if (typeof args.value === 'string' && args.value.length > OBSERVACIONES_REVISION_MAX) return `Las observaciones admiten como máximo ${OBSERVACIONES_REVISION_MAX} caracteres.`;
    return 'Las observaciones son obligatorias para OBSERVADO o RECHAZADO y deben contener texto.';
  }
}

export class CrearRevisionPatDto {
  @ApiProperty({ enum: RevisionPatResultado })
  @IsEnum(RevisionPatResultado)
  resultado: RevisionPatResultado;

  @ApiPropertyOptional({ nullable: true, maxLength: OBSERVACIONES_REVISION_MAX, example: 'Corregir los objetivos y completar la metodología.' })
  @Validate(ObservacionesRevisionCoherentes)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  observaciones?: string | null;
}
