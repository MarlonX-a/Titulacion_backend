import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RevisionPatResultado } from '../enums/revision-pat-resultado.enum.js';

export class RevisionPatResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) documento_pat_id: string;
  @ApiProperty({ format: 'uuid' }) revisor_id: string;
  @ApiProperty({ enum: RevisionPatResultado }) resultado: RevisionPatResultado;
  @ApiPropertyOptional({ nullable: true }) observaciones: string | null;
  @ApiProperty({ format: 'date-time' }) fecha_revision: Date;
  @ApiProperty({ type: Object }) revisor: { id: string; nombres: string; apellidos: string };
}
