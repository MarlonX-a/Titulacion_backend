import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

function parseActive(value: unknown): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

export class ListLineasQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => parseActive(value))
  @IsBoolean()
  activa?: boolean;
}
