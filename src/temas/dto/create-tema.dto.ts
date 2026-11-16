import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsString, IsUUID, Length, ValidateIf } from 'class-validator';
import { TipoTema } from '../enums/tipo-tema.enum.js';

const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;
const presente = (_object: object, value: unknown): boolean => value !== undefined && value !== null;

export class CreateTemaDto {
  @ApiProperty({ format: 'uuid', description: 'Carrera del banco; el docente proponente debe ser de la misma carrera.' })
  @IsUUID()
  carrera_id: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  linea_id: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  docente_proponente_id: string;

  @ApiProperty({ enum: TipoTema, description: 'INDIVIDUAL = 1 integrante, PAREJA = 2, GRUPO = 3 hasta el máximo del período.' })
  @IsEnum(TipoTema)
  tipo: TipoTema;

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

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Programa de la misma carrera con cupo. Obligatorio para COORDINADOR (uno de sus programas).' })
  @ValidateIf(presente)
  @IsUUID()
  programa_id?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 120, description: 'Categoría libre del tema dentro del programa.' })
  @ValidateIf(presente)
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  categoria?: string | null;
}
