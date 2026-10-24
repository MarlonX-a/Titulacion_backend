import { Transform, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Length, Max, Min } from 'class-validator';
import { FechasPeriodoDto } from './fechas-periodo.dto.js';

function trimText(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreatePeriodoDto extends FechasPeriodoDto {
  @ApiProperty({ maxLength: 20 })
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @IsString()
  @Length(1, 20)
  codigo: string;

  @ApiProperty({ maxLength: 120 })
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @IsString()
  @Length(1, 120)
  nombre: string;

  @ApiProperty({ minimum: 1, maximum: 32767, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(32767)
  max_integrantes_default: number;
}
