import { ApiProperty } from '@nestjs/swagger';
import { UsuarioRol } from '../../usuarios/enums/usuario-rol.enum.js';

export class AuditoriaActorDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() email: string;
  @ApiProperty() nombres: string;
  @ApiProperty() apellidos: string;
  @ApiProperty({ enum: UsuarioRol }) rol: UsuarioRol;
}

export class AuditoriaResponseDto {
  @ApiProperty({ description: 'Identificador bigint serializado como texto.', example: '1024' }) id: string;
  @ApiProperty({ type: AuditoriaActorDto }) actor: AuditoriaActorDto;
  @ApiProperty() accion: string;
  @ApiProperty() entidad_tipo: string;
  @ApiProperty({ format: 'uuid' }) entidad_id: string;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) valores_anteriores: Record<string, unknown> | null;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) valores_nuevos: Record<string, unknown> | null;
  @ApiProperty({ type: String, nullable: true, example: '10.0.0.5' }) ip_origen: string | null;
  @ApiProperty({ format: 'date-time' }) fecha_hora: Date;
}

export class AuditoriaPageDto {
  @ApiProperty({ type: [AuditoriaResponseDto] }) data: AuditoriaResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
