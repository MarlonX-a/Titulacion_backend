import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface, IsEnum, Validate } from 'class-validator';
import { RevisionPatResultado } from '../enums/revision-pat-resultado.enum.js';

@ValidatorConstraint({ name: 'observacionesRevisionCoherentes', async: false })
class ObservacionesRevisionCoherentes implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as CrearRevisionPatDto;
    if (dto.resultado === RevisionPatResultado.APROBADO) return value === undefined || value === null || typeof value === 'string';
    return typeof value === 'string' && value.trim().length > 0;
  }

  defaultMessage(): string {
    return 'Las observaciones son obligatorias para OBSERVADO o RECHAZADO y deben contener texto.';
  }
}

export class CrearRevisionPatDto {
  @ApiProperty({ enum: RevisionPatResultado })
  @IsEnum(RevisionPatResultado)
  resultado: RevisionPatResultado;

  @ApiPropertyOptional({ nullable: true, example: 'Corregir los objetivos y completar la metodología.' })
  @Validate(ObservacionesRevisionCoherentes)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  observaciones?: string | null;
}
