import { ApiProperty } from '@nestjs/swagger';
import { GrupoEstado } from '../enums/grupo-estado.enum.js';
import { GrupoIntegranteEstado } from '../enums/grupo-integrante-estado.enum.js';
import { GrupoIntegranteRol } from '../enums/grupo-integrante-rol.enum.js';

export class GrupoPersonaDto {
  @ApiProperty() id: string;
  @ApiProperty() nombres: string;
  @ApiProperty() apellidos: string;
  @ApiProperty() matricula: string;
}

export class GrupoIntegranteResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() estudiante_id: string;
  @ApiProperty({ type: GrupoPersonaDto }) estudiante: GrupoPersonaDto;
  @ApiProperty({ enum: GrupoIntegranteRol }) rol_en_grupo: GrupoIntegranteRol;
  @ApiProperty({ enum: GrupoIntegranteEstado }) estado: GrupoIntegranteEstado;
  @ApiProperty() fecha_ingreso: Date;
  @ApiProperty({ nullable: true }) fecha_salida: Date | null;
  @ApiProperty({ nullable: true }) motivo_salida: string | null;
}

export class GrupoResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() periodo_id: string;
  @ApiProperty() nombre: string;
  @ApiProperty({ enum: GrupoEstado }) estado: GrupoEstado;
  @ApiProperty() creado_en: Date;
  @ApiProperty({ description: 'Indica que el grupo ya registró al menos una postulación.' }) composicion_cerrada: boolean;
  @ApiProperty({ type: GrupoPersonaDto, nullable: true }) representante: GrupoPersonaDto | null;
  @ApiProperty({ type: [GrupoIntegranteResponseDto] }) integrantes: GrupoIntegranteResponseDto[];
}

export class PagedGruposResponseDto {
  @ApiProperty({ type: [GrupoResponseDto] }) data: GrupoResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
