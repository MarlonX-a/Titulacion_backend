import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID, Length, Validate } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CedulaEcuatorianaValidator } from '../../common/validators/cedula-ecuatoriana.validator.js';

function trimText(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateDocenteDto {
  @ApiProperty({ format: 'uuid', description: 'Cuenta existente con rol DOCENTE.' })
  @IsUUID()
  usuario_id: string;

  @ApiProperty({ example: '0102030400', maxLength: 20 })
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @IsString()
  @Validate(CedulaEcuatorianaValidator)
  cedula: string;

  @ApiProperty({ maxLength: 120 })
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @IsString()
  @Length(1, 120)
  titulo_academico: string;

  @ApiProperty({ maxLength: 120 })
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @IsString()
  @Length(1, 120)
  departamento: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  habilitado_tutoria?: boolean;
}
