import { ApiProperty } from '@nestjs/swagger';

export class ConfigCargaTutorialResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) periodo_id: string;
  @ApiProperty({ format: 'uuid', nullable: true }) docente_id: string | null;
  @ApiProperty({ minimum: 1, maximum: 32767 }) max_trabajos: number;
  @ApiProperty({ type: Boolean }) bloquear_al_superar: boolean;
}
