import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class CambiarRepresentanteDto {
  @ApiProperty({ format: 'uuid', description: 'ID del perfil de estudiante que ya integra el grupo.' })
  @IsUUID()
  estudiante_id: string;

  @ApiProperty({ example: 'Acuerdo entre los integrantes.' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  motivo: string;
}
