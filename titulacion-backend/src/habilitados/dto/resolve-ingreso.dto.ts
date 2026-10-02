import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsString, Length, ValidateIf } from 'class-validator';
import { SituacionIngreso } from '../enums/situacion-ingreso.enum.js';

export class ResolveIngresoDto {
  @ApiProperty({ enum: [SituacionIngreso.ADMITIDO, SituacionIngreso.NO_ADMITIDO] })
  @IsIn([SituacionIngreso.ADMITIDO, SituacionIngreso.NO_ADMITIDO])
  situacion_ingreso: SituacionIngreso.ADMITIDO | SituacionIngreso.NO_ADMITIDO;

  @ApiPropertyOptional({ description: 'Obligatoria para NO_ADMITIDO.' })
  @ValidateIf((dto: ResolveIngresoDto, value: unknown) =>
    value !== undefined || dto.situacion_ingreso === SituacionIngreso.NO_ADMITIDO,
  )
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1)
  observacion_ingreso?: string | null;
}
