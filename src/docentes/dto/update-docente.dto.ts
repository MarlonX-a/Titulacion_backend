import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { ApiHideProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocentePerfilOpcionalDto } from './docente-perfil-opcional.dto.js';
import { UsuarioEstado } from '../../usuarios/enums/usuario-estado.enum.js';

function trimText(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** Edición administrativa de un docente. El correo es el usuario de acceso y no se edita. */
export class UpdateDocenteDto extends DocentePerfilOpcionalDto {
  @ApiHideProperty()
  @Equals(undefined, { message: 'El correo es el usuario de acceso y no se puede modificar.' })
  email?: undefined;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @IsString({ message: 'nombres debe ser texto.' })
  @Length(1, 100, { message: 'nombres debe tener entre 1 y 100 caracteres.' })
  nombres?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @IsString({ message: 'apellidos debe ser texto.' })
  @Length(1, 100, { message: 'apellidos debe tener entre 1 y 100 caracteres.' })
  apellidos?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  habilitado_tutoria?: boolean;

  @ApiPropertyOptional({ enum: UsuarioEstado, description: 'INACTIVO impide el acceso y revoca las sesiones vigentes.' })
  @IsOptional()
  @IsIn(Object.values(UsuarioEstado), { message: 'estado debe ser ACTIVO o INACTIVO.' })
  estado?: UsuarioEstado;
}
