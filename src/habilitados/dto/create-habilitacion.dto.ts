import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsString, IsUUID, Length, MaxLength, ValidateIf } from 'class-validator';
import { CondicionIngreso } from '../enums/condicion-ingreso.enum.js';

export class CreateHabilitacionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  estudiante_id: string;

  @ApiProperty({ enum: CondicionIngreso })
  @IsEnum(CondicionIngreso)
  condicion_ingreso: CondicionIngreso;

  @ApiPropertyOptional({ nullable: true, description: 'Obligatorio para CONDICIONADO; omitido o null para REGULAR.', maxLength: 1000 })
  @ValidateIf((dto: CreateHabilitacionDto) => dto.condicion_ingreso === CondicionIngreso.CONDICIONADO)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1)
  @MaxLength(1000)
  requisito_pendiente?: string | null;
}
