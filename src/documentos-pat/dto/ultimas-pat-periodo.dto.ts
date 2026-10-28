import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { DocumentoPatResponseDto } from './documento-pat-response.dto.js';

export enum EstadoUltimaPat {
  PENDIENTE = 'PENDIENTE',
  APROBADO = 'APROBADO',
  OBSERVADO = 'OBSERVADO',
  RECHAZADO = 'RECHAZADO',
  SIN_ENTREGA = 'SIN_ENTREGA',
}

export class ListUltimasPatQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: EstadoUltimaPat, description: 'Filtra por el estado de revisión de la última versión (SIN_ENTREGA: sin documentos).' })
  @IsOptional() @IsEnum(EstadoUltimaPat) estado?: EstadoUltimaPat;
}

export class UltimaPatParticipanteDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() nombres: string;
  @ApiProperty() apellidos: string;
  @ApiProperty() matricula: string;
}

export class UltimaPatAsignacionDto {
  @ApiProperty({ format: 'uuid' }) asignacion_tema_id: string;
  @ApiProperty({ type: Object }) tema: { id: string; titulo: string };
  @ApiProperty({ type: Object, nullable: true }) grupo: { id: string; nombre: string } | null;
  @ApiProperty({ type: [UltimaPatParticipanteDto] }) participantes: UltimaPatParticipanteDto[];
  @ApiProperty({ enum: EstadoUltimaPat }) estado: EstadoUltimaPat;
  @ApiProperty({ type: DocumentoPatResponseDto, nullable: true, description: 'Última versión con su revisión; null si no hay entregas.' }) documento: DocumentoPatResponseDto | null;
}

export class PagedUltimasPatResponseDto {
  @ApiProperty({ type: [UltimaPatAsignacionDto] }) data: UltimaPatAsignacionDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
