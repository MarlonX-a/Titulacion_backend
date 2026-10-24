import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CargarDocumentoPatDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  plantilla_id: string;
}
