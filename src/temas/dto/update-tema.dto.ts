import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsString, IsUUID, Length, Max, Min, ValidateIf } from 'class-validator';

const supplied = (_object: object, value: unknown): boolean => value !== undefined;
const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;

export class UpdateTemaDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf(supplied)
  @IsUUID()
  linea_id?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf(supplied)
  @IsUUID()
  docente_proponente_id?: string;

  @ApiPropertyOptional({ maxLength: 250 })
  @ValidateIf(supplied)
  @Transform(trim)
  @IsString()
  @Length(1, 250)
  titulo?: string;

  @ApiPropertyOptional({ maxLength: 20_000 })
  @ValidateIf(supplied)
  @Transform(trim)
  @IsString()
  @Length(1, 20_000)
  descripcion?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 32767, type: Number })
  @ValidateIf(supplied)
  @IsInt()
  @Min(1)
  @Max(32767)
  min_integrantes?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 32767, type: Number })
  @ValidateIf(supplied)
  @IsInt()
  @Min(1)
  @Max(32767)
  max_integrantes?: number;
}
