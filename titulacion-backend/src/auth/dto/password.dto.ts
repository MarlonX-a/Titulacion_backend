import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';

export class NewPasswordDto {
  @ApiProperty({ minLength: 15, maxLength: 128 })
  @IsString()
  @Length(15, 128)
  password: string;
}

export class ChangePasswordDto extends NewPasswordDto {
  @ApiProperty({ minLength: 15, maxLength: 128 })
  @IsString()
  @Length(15, 128)
  current_password: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'estudiante@live.uleam.edu.ec' })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  @Length(3, 150)
  email: string;
}

export class ResetPasswordDto extends NewPasswordDto {
  @ApiProperty()
  @IsString()
  @Length(32, 128)
  code: string;
}
