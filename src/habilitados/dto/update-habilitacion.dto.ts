import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { CondicionIngreso } from '../enums/condicion-ingreso.enum.js';

@ValidatorConstraint({ name: 'requisitoSegunCondicion', async: false })
class RequisitoSegunCondicion implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as UpdateHabilitacionDto;
    if (dto.condicion_ingreso === CondicionIngreso.CONDICIONADO) {
      return typeof value === 'string' && value.trim().length > 0;
    }
    return value === undefined || value === null;
  }

  defaultMessage(): string {
    return 'El requisito pendiente es obligatorio para CONDICIONADO y debe omitirse o ser null para REGULAR.';
  }
}

export class UpdateHabilitacionDto {
  @ApiProperty({ enum: CondicionIngreso })
  @IsEnum(CondicionIngreso)
  condicion_ingreso: CondicionIngreso;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Obligatorio para CONDICIONADO; omitido o null para REGULAR.',
    example: 'Le falta aprobar el requisito de inglés.',
  })
  @Validate(RequisitoSegunCondicion)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  requisito_pendiente?: string | null;
}
