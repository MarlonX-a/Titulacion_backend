import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;

/**
 * Cuerpo opcional de abrir/cerrar postulación e iniciar titulación. Sin `forzar` la transición
 * conserva sus reglas de fecha; con `forzar=true` y la fecha aún no alcanzada, la fecha
 * correspondiente pasa a la hora actual en la misma transacción y se audita con el motivo.
 */
export class TransicionPeriodoDto {
  @ApiPropertyOptional({ type: Boolean, default: false, description: 'Forzar la transición aunque la fecha configurada no se haya alcanzado; ajusta esa fecha a la hora actual.' })
  @IsOptional()
  @IsBoolean({ message: 'forzar debe ser verdadero o falso.' })
  forzar?: boolean;

  @ApiPropertyOptional({ minLength: 10, maxLength: 500, description: 'Obligatorio cuando forzar=true.' })
  @ValidateIf((dto: TransicionPeriodoDto) => dto.forzar === true || dto.motivo !== undefined)
  @Transform(trim)
  @IsString({ message: 'motivo debe ser texto.' })
  @Length(10, 500, { message: 'El motivo de una transición forzada debe tener entre 10 y 500 caracteres.' })
  motivo?: string;
}
