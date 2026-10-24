import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class AsignarTutorDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  docente_id: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Omitir o enviar null para una asignación directa.' })
  @IsOptional()
  @IsUUID()
  tutor_propuesto_id?: string | null;
}
