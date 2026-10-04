import { Transform, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, IsUUID, Length, Max, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;

export class CreateTemaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  linea_id: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  docente_proponente_id: string;

  @ApiProperty({ maxLength: 250 })
  @Transform(trim)
  @IsString()
  @Length(1, 250)
  titulo: string;

  @ApiProperty({ maxLength: 20_000 })
  @Transform(trim)
  @IsString()
  @Length(1, 20_000)
  descripcion: string;

  @ApiProperty({ minimum: 1, maximum: 32767, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(32767)
  min_integrantes: number;

  @ApiProperty({ minimum: 1, maximum: 32767, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(32767)
  max_integrantes: number;
}
