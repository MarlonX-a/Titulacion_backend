import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class ConfirmarPatInversoDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Candidato del equipo que queda como tutor vigente. Obligatorio si el nombre del Word no coincide con ninguno.' })
  @IsOptional()
  @IsUUID()
  candidato_id?: string;
}
