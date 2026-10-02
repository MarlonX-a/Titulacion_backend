import { Transform, Type } from 'class-transformer';
import { IsInt, IsString, IsUUID, Length, Max, Min, Validate } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CedulaEcuatorianaValidator } from '../../common/validators/cedula-ecuatoriana.validator.js';

function trimText(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateEstudianteDto {
  @ApiProperty({ format: 'uuid', description: 'Cuenta existente con rol ESTUDIANTE.' })
  @IsUUID()
  usuario_id: string;

  @ApiProperty({ example: '0102030400', maxLength: 20 })
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @IsString()
  @Validate(CedulaEcuatorianaValidator)
  cedula: string;

  @ApiProperty({ maxLength: 20 })
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @IsString()
  @Length(1, 20)
  matricula: string;

  @ApiProperty({ maxLength: 120 })
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @IsString()
  @Length(1, 120)
  carrera: string;

  @ApiProperty({ minimum: 1, maximum: 32767, type: Number })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(32767)
  nivel: number;
}
