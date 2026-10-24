import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsNumber, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CriterioConflicto } from '../enums/criterio-conflicto.enum.js';

export class ConflictoParticipanteDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() postulacion_id: string;
  @ApiPropertyOptional({ minimum: -9999.99, maximum: 9999.99, type: Number })
  @ValidateIf((_object, value: unknown) => value !== undefined) @IsNumber({ maxDecimalPlaces: 2 }) @Min(-9999.99) @Max(9999.99) puntaje_criterio?: number;
}

export class ResolverConflictoDto {
  @ApiProperty({ enum: CriterioConflicto }) @IsEnum(CriterioConflicto) criterio_aplicado: CriterioConflicto;
  @ApiProperty({ format: 'uuid' }) @IsUUID() postulacion_ganadora_id: string;
  @ApiProperty({ maxLength: 5000 }) @IsString() @MinLength(1) @MaxLength(5000) @Matches(/\S/) justificacion: string;
  @ApiProperty({ type: [ConflictoParticipanteDto], minItems: 2 })
  @IsArray() @ArrayMinSize(2) @ValidateNested({ each: true }) @Type(() => ConflictoParticipanteDto)
  participantes: ConflictoParticipanteDto[];
}
