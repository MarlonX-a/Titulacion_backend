import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class ListConfigCargaTutorialQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ default: false, description: 'Incluye los límites específicos desactivados (historial).' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  incluir_inactivas?: boolean;
}
