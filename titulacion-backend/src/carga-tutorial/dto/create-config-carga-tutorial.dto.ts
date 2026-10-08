import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsUUID, Max, Min, ValidateIf } from 'class-validator';

export class CreateConfigCargaTutorialDto {
  @ApiPropertyOptional({ nullable: true, format: 'uuid', description: 'Omitir o enviar null para configurar el límite global del período.' })
  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsUUID()
  docente_id?: string | null;

  @ApiProperty({ minimum: 1, maximum: 32767 })
  @IsInt()
  @Min(1)
  @Max(32767)
  max_trabajos: number;

  @ApiProperty()
  @IsBoolean()
  bloquear_al_superar: boolean;
}
