import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsString, Length, Matches, Validate, ValidatorConstraint, ValidatorConstraintInterface, type ValidationArguments } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UsuarioRol } from '../enums/usuario-rol.enum.js';

@ValidatorConstraint({ name: 'correoInstitucionalPorRol', async: false })
class CorreoInstitucionalPorRol implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (typeof value !== 'string') return false;
    const dto = args.object as CreateUsuarioDto;
    const email = value.toLowerCase();
    return dto.rol === UsuarioRol.ESTUDIANTE
      ? /^[^@]+@live\.uleam\.edu\.ec$/.test(email)
      : /^[^@]+@(?:live\.)?uleam\.edu\.ec$/.test(email);
  }

  defaultMessage(): string {
    return 'El dominio del correo no está permitido para el rol indicado.';
  }
}

export class CreateUsuarioDto {
  @ApiProperty({ maxLength: 150, example: 'persona@live.uleam.edu.ec' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'email debe tener un formato válido.' })
  @Length(1, 150, { message: 'email debe tener máximo 150 caracteres.' })
  @Validate(CorreoInstitucionalPorRol)
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

}
