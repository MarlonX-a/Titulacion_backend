import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsUUID } from 'class-validator';
import { TipoTema } from '../../temas/enums/tipo-tema.enum.js';

/** Multipart text fields that accompany the topics workbook. */
export class ValidarImportacionTemasDto {
  @ApiProperty({ format: 'uuid', description: 'Carrera del banco; prevalece sobre la columna Carrera del Excel.' })
  @IsUUID('all', { message: 'Seleccione la carrera de la importación.' })
  carrera_id: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: 'Seleccione la línea de investigación.' })
  linea_id: string;

  @ApiProperty({ enum: TipoTema })
  @IsEnum(TipoTema, { message: 'Seleccione el tipo de tema (INDIVIDUAL, PAREJA o GRUPO).' })
  tipo: TipoTema;
}
