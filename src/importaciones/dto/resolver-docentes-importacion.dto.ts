import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, IsUUID, Length, ValidateNested } from 'class-validator';

export class ResolucionDocenteDto {
  @ApiProperty({ maxLength: 200, description: 'Nombre del docente tal como aparece en el Excel (se compara normalizado).' })
  @IsString()
  @Length(1, 200)
  nombre_excel: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  docente_id: string;
}

/** Applies each resolution to every preview row with that Excel teacher name. */
export class ResolverDocentesImportacionDto {
  @ApiProperty({ type: [ResolucionDocenteDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ResolucionDocenteDto)
  resoluciones: ResolucionDocenteDto[];
}
