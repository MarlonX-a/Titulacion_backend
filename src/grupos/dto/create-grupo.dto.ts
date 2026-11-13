import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';
import { NOMBRE_GRUPO_MENSAJE, NOMBRE_GRUPO_PATRON, TextoSeguro } from '../../common/validators/texto-seguro.validator.js';

export class CreateGrupoDto {
  @ApiProperty({
    maxLength: 120,
    example: 'Grupo de titulación A',
    description: 'Letras, números, espacios y - _ , \' ( ) & #. Sin enlaces ni caracteres invisibles o de dirección de escritura.',
  })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 120)
  @TextoSeguro()
  @Matches(NOMBRE_GRUPO_PATRON, { message: NOMBRE_GRUPO_MENSAJE })
  nombre: string;
}
