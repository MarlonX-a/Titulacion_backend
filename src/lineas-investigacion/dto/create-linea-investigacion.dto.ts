import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, Length, MinLength, ValidateIf } from 'class-validator';

function trimText(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateLineaInvestigacionDto {
  @ApiProperty({ maxLength: 20, example: 'INTELIGENCIA-ART' })
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @IsString()
  @Length(1, 20)
  codigo: string;

  @ApiProperty({ maxLength: 150, example: 'Inteligencia artificial' })
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @IsString()
  @Length(1, 150)
  nombre: string;

  @ApiPropertyOptional({ example: 'Aprendizaje automático y sistemas inteligentes.' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @IsString()
  @MinLength(1)
  descripcion?: string;
}
