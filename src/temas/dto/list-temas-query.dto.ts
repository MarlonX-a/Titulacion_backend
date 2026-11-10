import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { EstadoTema } from '../enums/estado-tema.enum.js';
import { TipoTema } from '../enums/tipo-tema.enum.js';

/** Reads the raw query value so implicit conversion cannot turn the string "false" into true. */
const booleano = ({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown => {
  const raw = obj[key];
  if (raw === 'true' || raw === true) return true;
  if (raw === 'false' || raw === false) return false;
  return raw;
};

export class ListTemasQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Período de contexto: obligatorio para ESTUDIANTE; fija el máximo de GRUPO y cuenta las postulaciones abiertas de ese período.' })
  @IsOptional()
  @IsUUID()
  periodo_id?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Filtra por carrera (para ESTUDIANTE se usa siempre su carrera).' })
  @IsOptional()
  @IsUUID()
  carrera_id?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  linea_id?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  docente_proponente_id?: string;

  @ApiPropertyOptional({ enum: EstadoTema })
  @IsOptional()
  @IsEnum(EstadoTema)
  estado?: EstadoTema;

  @ApiPropertyOptional({ enum: TipoTema })
  @IsOptional()
  @IsEnum(TipoTema)
  tipo?: TipoTema;

  @ApiPropertyOptional({ type: Boolean, description: 'true: PUBLICADO sin asignación VIGENTE; false: el resto.' })
  @IsOptional()
  @Transform(booleano)
  @IsBoolean()
  disponible?: boolean;
}
