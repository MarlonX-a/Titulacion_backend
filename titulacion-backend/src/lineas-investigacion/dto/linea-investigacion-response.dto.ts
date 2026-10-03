import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LineaInvestigacionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ maxLength: 20 })
  codigo: string;

  @ApiProperty({ maxLength: 150 })
  nombre: string;

  @ApiPropertyOptional({ nullable: true })
  descripcion: string | null;

  @ApiProperty()
  activa: boolean;
}
