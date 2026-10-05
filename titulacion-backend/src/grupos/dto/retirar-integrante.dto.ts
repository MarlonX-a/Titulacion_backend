import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

export class RetirarIntegranteDto {
  @ApiProperty({ example: 'La cuenta ya no participa en el proceso.' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  motivo: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Obligatorio al retirar al representante si quedan otros integrantes.' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID()
  nuevo_representante_id?: string;
}
