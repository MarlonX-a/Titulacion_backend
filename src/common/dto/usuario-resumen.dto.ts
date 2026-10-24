import { ApiProperty } from '@nestjs/swagger';
import { UsuarioEstado } from '../../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../../usuarios/enums/usuario-rol.enum.js';

export class UsuarioResumenDto {
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
}
