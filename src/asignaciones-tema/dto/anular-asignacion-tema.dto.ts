import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, Length } from 'class-validator';
import { AsignacionTemaCausa } from '../enums/asignacion-tema-causa.enum.js';

export class AnularAsignacionTemaDto {
  @ApiProperty({ enum: AsignacionTemaCausa, example: AsignacionTemaCausa.OTRA })
  @IsEnum(AsignacionTemaCausa)
  causa: AsignacionTemaCausa;

  @ApiProperty({ minLength: 1, maxLength: 1000, example: 'El grupo desistió del trabajo de titulación.' })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 1000)
  motivo: string;
}
