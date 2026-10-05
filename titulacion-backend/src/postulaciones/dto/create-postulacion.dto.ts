import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsUUID } from 'class-validator';
import { ModalidadPostulacion } from '../enums/modalidad-postulacion.enum.js';

export class CreatePostulacionDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() tema_id: string;
  @ApiProperty({ enum: ModalidadPostulacion }) @IsEnum(ModalidadPostulacion) modalidad: ModalidadPostulacion;
}
