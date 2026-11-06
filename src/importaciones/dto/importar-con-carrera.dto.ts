import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** Campo de texto del formulario multipart que acompaña al archivo. */
export class ImportarConCarreraDto {
  @ApiProperty({ format: 'uuid', description: 'Carrera elegida en el formulario de importación.' })
  @IsUUID('all', { message: 'Seleccione la carrera de la importación.' })
  carrera_id: string;
}
