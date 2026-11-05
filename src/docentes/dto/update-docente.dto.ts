import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsIn, IsOptional, IsString, Length, Validate } from 'class-validator';
import { ApiHideProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CedulaEcuatorianaValidator } from '../../common/validators/cedula-ecuatoriana.validator.js';
import { UsuarioEstado } from '../../usuarios/enums/usuario-estado.enum.js';

function trimText(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** Los datos opcionales del perfil vacíos se guardan como NULL. */
function optionalText(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Edición administrativa de un docente. El correo es el usuario de acceso y no se edita. */
export class UpdateDocenteDto {
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

  @ApiPropertyOptional({ example: '0102030400', maxLength: 20, nullable: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalText(value))
  @IsString()
  @Validate(CedulaEcuatorianaValidator)
  cedula?: string | null;

  @ApiPropertyOptional({ maxLength: 120, nullable: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalText(value))
  @IsString()
  @Length(1, 120)
  titulo_academico?: string | null;

  @ApiPropertyOptional({ maxLength: 120, nullable: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalText(value))
  @IsString()
  @Length(1, 120)
  departamento?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  habilitado_tutoria?: boolean;

  @ApiPropertyOptional({ enum: UsuarioEstado, description: 'INACTIVO impide el acceso y revoca las sesiones vigentes.' })
  @IsOptional()
  @IsIn(Object.values(UsuarioEstado), { message: 'estado debe ser ACTIVO o INACTIVO.' })
  estado?: UsuarioEstado;
}
