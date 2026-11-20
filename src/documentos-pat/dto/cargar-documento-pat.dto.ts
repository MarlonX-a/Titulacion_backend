import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CargarDocumentoPatDto {
  @ApiProperty({ format: 'uuid', description: 'Generación individual a la que corresponde el PDF firmado.' })
  @IsUUID()
  generacion_id?: string;
  /**
   * @deprecated Solo para compilar verificadores históricos; la API lo rechaza por whitelist.
   * `declare` evita que la clase cree la propiedad (con valor undefined) al instanciar el DTO: con
   * `forbidNonWhitelisted` esa propiedad propia hacía fallar toda carga con «property plantilla_id should not exist».
   */
  declare plantilla_id?: string;
}
