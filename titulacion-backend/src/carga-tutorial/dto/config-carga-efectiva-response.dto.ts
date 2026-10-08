import { ApiProperty } from '@nestjs/swagger';
import { ConfigCargaOrigen } from '../enums/config-carga-origen.enum.js';
import { ConfigCargaTutorialResponseDto } from './config-carga-tutorial-response.dto.js';

export class ConfigCargaEfectivaResponseDto {
  @ApiProperty({ format: 'uuid' }) periodo_id: string;
  @ApiProperty({ format: 'uuid' }) docente_id: string;
  @ApiProperty({ enum: ConfigCargaOrigen }) origen: ConfigCargaOrigen;
  @ApiProperty({ type: ConfigCargaTutorialResponseDto, nullable: true })
  configuracion: ConfigCargaTutorialResponseDto | null;
}
