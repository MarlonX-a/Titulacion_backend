import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UsuarioRol } from '../enums/usuario-rol.enum.js';

export class CreateUsuarioDto {
  @ApiProperty({ maxLength: 150, example: 'persona@universidad.edu' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'email debe tener un formato válido.' })
  @Length(1, 150, { message: 'email debe tener máximo 150 caracteres.' })
  email: string;

  @ApiProperty({ maxLength: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'nombres debe ser texto.' })
  @Length(1, 100, { message: 'nombres debe tener entre 1 y 100 caracteres.' })
  @Matches(/\S/, { message: 'nombres no puede estar vacío.' })
  nombres: string;

  @ApiProperty({ maxLength: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'apellidos debe ser texto.' })
  @Length(1, 100, {
    message: 'apellidos debe tener entre 1 y 100 caracteres.',
  })
  @Matches(/\S/, { message: 'apellidos no puede estar vacío.' })
  apellidos: string;

  @ApiProperty({ enum: UsuarioRol, enumName: 'UsuarioRol' })
  @IsEnum(UsuarioRol, { message: 'rol no es válido.' })
  rol: UsuarioRol;

  @ApiProperty({
    maxLength: 100,
    description: 'Valor sub del token institucional.',
  })
  @IsString({ message: 'id_externo_sso debe ser texto.' })
  @Length(1, 100, {
    message: 'id_externo_sso debe tener entre 1 y 100 caracteres.',
  })
  @Matches(/\S/, { message: 'id_externo_sso no puede estar vacío.' })
  id_externo_sso: string;
}
