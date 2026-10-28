import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
  type ValidationArguments,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CedulaEcuatorianaValidator } from '../../common/validators/cedula-ecuatoriana.validator.js';

function trimText(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

interface CuentaCampos { email?: unknown; nombres?: unknown; apellidos?: unknown; usuario_id?: unknown }

function tieneDatosDeCuenta(object: CuentaCampos): boolean {
  return object.email !== undefined || object.nombres !== undefined || object.apellidos !== undefined;
}

@ValidatorConstraint({ name: 'cuentaExistenteOAlta', async: false })
class CuentaExistenteOAlta implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    return !tieneDatosDeCuenta(args.object as CuentaCampos);
  }

  defaultMessage(): string {
    return 'Envía usuario_id para vincular una cuenta existente o email, nombres y apellidos para crearla, pero no ambos.';
  }
}

/**
 * Alta de un perfil docente. Con `usuario_id` vincula una cuenta DOCENTE existente; sin él crea,
 * en la misma transacción, la cuenta DOCENTE (clave temporal y correo de acceso) y el perfil.
 */
export class CreateDocenteDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Cuenta existente con rol DOCENTE. Omitir para crear la cuenta con email, nombres y apellidos.' })
  @ValidateIf((object: CuentaCampos) => object.usuario_id !== undefined || !tieneDatosDeCuenta(object))
  @IsUUID('all', { message: 'usuario_id debe ser un UUID; si la cuenta no existe, envía email, nombres y apellidos.' })
  @Validate(CuentaExistenteOAlta)
  usuario_id?: string;

  @ApiPropertyOptional({ maxLength: 150, example: 'docente@uleam.edu.ec', description: 'Obligatorio sin usuario_id. Dominio @uleam.edu.ec o @live.uleam.edu.ec.' })
  @ValidateIf((object: CuentaCampos) => object.usuario_id === undefined)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail({}, { message: 'email debe tener un formato válido.' })
  @Length(1, 150, { message: 'email debe tener máximo 150 caracteres.' })
  @Matches(/^[^@]+@(?:live\.)?uleam\.edu\.ec$/, { message: 'El correo de un docente debe ser @uleam.edu.ec o @live.uleam.edu.ec.' })
  email?: string;

  @ApiPropertyOptional({ maxLength: 100, description: 'Obligatorio sin usuario_id.' })
  @ValidateIf((object: CuentaCampos) => object.usuario_id === undefined)
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @IsString({ message: 'nombres debe ser texto.' })
  @Length(1, 100, { message: 'nombres debe tener entre 1 y 100 caracteres.' })
  nombres?: string;

  @ApiPropertyOptional({ maxLength: 100, description: 'Obligatorio sin usuario_id.' })
  @ValidateIf((object: CuentaCampos) => object.usuario_id === undefined)
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @IsString({ message: 'apellidos debe ser texto.' })
  @Length(1, 100, { message: 'apellidos debe tener entre 1 y 100 caracteres.' })
  apellidos?: string;

  @ApiProperty({ example: '0102030400', maxLength: 20 })
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @IsString()
  @Validate(CedulaEcuatorianaValidator)
  cedula: string;

  @ApiProperty({ maxLength: 120 })
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @IsString()
  @Length(1, 120)
  titulo_academico: string;

  @ApiProperty({ maxLength: 120 })
  @Transform(({ value }: { value: unknown }) => trimText(value))
  @IsString()
  @Length(1, 120)
  departamento: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  habilitado_tutoria?: boolean;
}
