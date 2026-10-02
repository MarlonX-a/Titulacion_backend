import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LocalLoginDto {
  @ApiProperty({ example: 'admin@example.test', maxLength: 150 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'email debe tener un formato válido.' })
  @Length(1, 150, { message: 'email debe tener máximo 150 caracteres.' })
  email: string;

  @ApiProperty({ minLength: 1, maxLength: 256, writeOnly: true })
  @IsString({ message: 'password debe ser texto.' })
  @Length(1, 256, {
    message: 'password debe tener entre 1 y 256 caracteres.',
  })
  password: string;
}
