import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsEnum, IsUUID } from 'class-validator';
import { ModalidadPostulacion } from '../enums/modalidad-postulacion.enum.js';

export class CreatePostulacionDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() tema_id: string;
  @ApiProperty({ enum: ModalidadPostulacion }) @IsEnum(ModalidadPostulacion) modalidad: ModalidadPostulacion;
  @ApiProperty({ type: [String], format: 'uuid', minItems: 1, maxItems: 5 })
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(5, { message: 'Se pueden proponer como máximo 5 tutores.' }) @ArrayUnique((id: string) => id.toLowerCase()) @IsUUID('all', { each: true })
  tutores_propuestos: string[];
}
