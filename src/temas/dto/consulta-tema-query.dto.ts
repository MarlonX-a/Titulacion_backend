import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/** Period context of a topic detail: required for ESTUDIANTE, sets the GRUPO upper bound. */
export class ConsultaTemaQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  periodo_id?: string;
}
