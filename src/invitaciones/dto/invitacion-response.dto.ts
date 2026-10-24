import { ApiProperty } from '@nestjs/swagger';
import { InvitacionEstado } from '../enums/invitacion-estado.enum.js';
import { GrupoEstado } from '../../grupos/enums/grupo-estado.enum.js';

export class InvitacionPersonaDto {
  @ApiProperty() id: string;
  @ApiProperty() nombres: string;
  @ApiProperty() apellidos: string;
  @ApiProperty() matricula: string;
}

export class InvitacionResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() grupo_id: string;
  @ApiProperty() periodo_id: string;
  @ApiProperty({ type: 'object', properties: { id: { type: 'string' }, nombre: { type: 'string' }, estado: { enum: Object.values(GrupoEstado) } } })
  grupo: { id: string; nombre: string; estado: GrupoEstado };
  @ApiProperty() estudiante_emisor_id: string;
  @ApiProperty({ type: InvitacionPersonaDto }) estudiante_emisor: InvitacionPersonaDto;
  @ApiProperty() estudiante_destino_id: string;
  @ApiProperty({ type: InvitacionPersonaDto }) estudiante_destino: InvitacionPersonaDto;
  @ApiProperty({ enum: InvitacionEstado }) estado: InvitacionEstado;
  @ApiProperty() fecha_envio: Date;
  @ApiProperty() expira_en: Date;
  @ApiProperty({ nullable: true }) fecha_respuesta: Date | null;
}

export class PagedInvitacionesResponseDto {
  @ApiProperty({ type: [InvitacionResponseDto] }) data: InvitacionResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
