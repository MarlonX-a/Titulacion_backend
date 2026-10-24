import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';
import { AsignarTutorDto } from './asignar-tutor.dto.js';

export class ReemplazarTutorDto extends AsignarTutorDto {
  @ApiProperty({ minLength: 1, maxLength: 1000 })
  @IsString()
  @Length(1, 1000)
  @Matches(/\S/, { message: 'El motivo no puede estar vacío.' })
  motivo: string;
}
