import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

export class PublicarPlantillaPatDto {
  @ApiProperty({ maxLength: 20, example: '2026-1' })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 20)
  @Matches(/\S/, { message: 'La versión no puede estar vacía.' })
  version: string;
}
