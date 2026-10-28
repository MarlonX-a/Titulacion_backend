import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

/** Motivo obligatorio para cerrar o retirar un tema; se registra en historial y auditoría. */
export class MotivoTemaDto {
  @ApiProperty({ minLength: 1, maxLength: 1000, example: 'El docente proponente dejó la institución.' })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 1000)
  motivo: string;
}
