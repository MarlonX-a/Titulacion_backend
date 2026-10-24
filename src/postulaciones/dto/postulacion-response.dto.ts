import { ApiProperty } from '@nestjs/swagger';
import { EstadoPostulacion } from '../enums/estado-postulacion.enum.js';

export class PagedPostulacionesResponseDto {
  @ApiProperty({ type: [Object] }) data: PostulacionResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}

export class PostulacionResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() periodo_id: string;
  @ApiProperty() tema_id: string;
  @ApiProperty({ type: Object }) tema: { id: string; titulo: string; min_integrantes: number; max_integrantes: number; estado: string };
  @ApiProperty({ nullable: true }) grupo_id: string | null;
  @ApiProperty({ nullable: true, type: Object }) grupo: { id: string; nombre: string } | null;
  @ApiProperty({ nullable: true }) estudiante_id: string | null;
  @ApiProperty({ type: [Object] }) participantes: Array<{ id: string; nombres: string; apellidos: string; matricula: string; habilitado: string | null; situacion_ingreso: string | null }>;
  @ApiProperty() num_integrantes: number;
  @ApiProperty() registrada_por_id: string;
  @ApiProperty({ type: Object }) registrada_por: { id: string; nombres: string; apellidos: string };
  @ApiProperty({ enum: EstadoPostulacion }) estado: EstadoPostulacion;
  @ApiProperty() fecha_postulacion: Date;
  @ApiProperty({ nullable: true }) observacion: string | null;
}
