import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, MaxLength } from 'class-validator';

export class CancelarPostulacionDto {
  @ApiProperty({ maxLength: 1000 }) @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @Length(1, 1000) @MaxLength(1000) motivo: string;
}
