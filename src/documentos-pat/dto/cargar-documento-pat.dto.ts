import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CargarDocumentoPatDto {
  @ApiProperty({ format: 'uuid', description: 'Generación individual a la que corresponde el PDF firmado.' })
  @IsUUID()
  generacion_id?: string;
  /** @deprecated Solo para compilar verificadores históricos; la API lo rechaza por whitelist. */
  plantilla_id?: string;
}
