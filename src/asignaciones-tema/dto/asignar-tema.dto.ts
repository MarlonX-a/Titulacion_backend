import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, MaxLength } from 'class-validator';

export class AsignarTemaDto {
  @ApiProperty({ maxLength: 1000, example: 'La comisión aprobó la candidatura según la evaluación registrada.' })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 1000)
  @MaxLength(1000)
  motivo: string;
}
