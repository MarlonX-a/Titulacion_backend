import { ApiProperty } from '@nestjs/swagger';

export class PlantillaPatPublicadorDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() nombres: string;
  @ApiProperty() apellidos: string;
}

export class PlantillaPatResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) periodo_id: string;
  @ApiProperty({ maxLength: 20 }) version: string;
  @ApiProperty({ maxLength: 200 }) nombre_archivo: string;
  @ApiProperty({ maxLength: 100 }) mime_type: string;
  @ApiProperty({ minimum: 1 }) tamano_bytes: number;
  @ApiProperty({ pattern: '^[a-f0-9]{64}$' }) hash_sha256: string;
  @ApiProperty({ format: 'date' }) fecha_vigencia_inicio: string;
  @ApiProperty({ format: 'date', nullable: true }) fecha_vigencia_fin: string | null;
  @ApiProperty({ format: 'uuid' }) publicada_por_id: string;
  @ApiProperty() activa: boolean;
  @ApiProperty({ type: PlantillaPatPublicadorDto }) publicador: PlantillaPatPublicadorDto;
}

export class PagedPlantillaPatResponseDto {
  @ApiProperty({ type: [PlantillaPatResponseDto] }) data: PlantillaPatResponseDto[];
  @ApiProperty({ minimum: 0 }) total: number;
  @ApiProperty({ minimum: 1 }) page: number;
  @ApiProperty({ minimum: 1, maximum: 100 }) limit: number;
}

export class PlantillaPatDownloadDto {
  @ApiProperty({ format: 'uri' }) url: string;
  @ApiProperty({ format: 'date-time' }) expira_en: Date;
}
