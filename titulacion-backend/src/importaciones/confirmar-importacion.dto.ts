import { ApiHideProperty } from '@nestjs/swagger';
import { Equals } from 'class-validator';

export class ConfirmarImportacionDto {
  @ApiHideProperty()
  @Equals(undefined)
  private readonly cuerpo_debe_estar_vacio?: undefined;
}
