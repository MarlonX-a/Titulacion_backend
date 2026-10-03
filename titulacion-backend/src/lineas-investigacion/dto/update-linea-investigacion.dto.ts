import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsString, Length, MinLength, ValidateIf } from 'class-validator';

function trimText(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

const supplied = (_object: object, value: unknown): boolean => value !== undefined;

export class UpdateLineaInvestigacionDto {
  @ApiPropertyOptional({ maxLength: 20 })
  @ValidateIf(supplied)
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @IsString()
  @Length(1, 20)
  codigo?: string;

  @ApiPropertyOptional({ maxLength: 150 })
  @ValidateIf(supplied)
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @IsString()
  @Length(1, 150)
  nombre?: string;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @IsString()
  @MinLength(1)
  descripcion?: string | null;

  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf(supplied)
  @IsBoolean()
  activa?: boolean;
}
