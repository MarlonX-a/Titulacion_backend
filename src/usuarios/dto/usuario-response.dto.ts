import { ApiProperty } from '@nestjs/swagger';
import { UsuarioEstado } from '../enums/usuario-estado.enum.js';
import { UsuarioRol } from '../enums/usuario-rol.enum.js';

export class UsuarioResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ maxLength: 150 })
  email: string;

  @ApiProperty({ maxLength: 100 })
  nombres: string;

  @ApiProperty({ maxLength: 100 })
  apellidos: string;

  @ApiProperty({ enum: UsuarioRol })
  rol: UsuarioRol;

  @ApiProperty({ enum: UsuarioEstado })
  estado: UsuarioEstado;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  ultimo_acceso: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  creado_en: Date;
}
