import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, Max, Min, ValidateIf } from 'class-validator';

export class UpdateConfigCargaTutorialDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 32767 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(32767)
  max_trabajos?: number;

  @ApiPropertyOptional()
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  bloquear_al_superar?: boolean;
}
