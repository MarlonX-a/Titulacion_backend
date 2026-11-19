import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { TipoTema } from '../../temas/enums/tipo-tema.enum.js';
import { EstadoTema } from '../../temas/enums/estado-tema.enum.js';
import { EstadoConfirmacion } from '../enums/estado-confirmacion.enum.js';
import { EstadoPostulacion } from '../enums/estado-postulacion.enum.js';

/** Cuerpo vacío de `POST /postulaciones/:id/confirmar`: el ValidationPipe rechaza propiedades extra. */
export class ConfirmarPostulacionDto {}

export class RechazarPostulacionDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 500, description: 'Motivo opcional que se guarda en la confirmación y en la observación de la postulación.' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString({ message: 'motivo debe ser texto.' })
  @Length(1, 500, { message: 'El motivo debe tener entre 1 y 500 caracteres.' })
  motivo?: string;
}

class TemaConfirmacionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() titulo: string;
  @ApiProperty({ enum: TipoTema }) tipo: TipoTema;
  @ApiProperty({ enum: EstadoTema }) estado: EstadoTema;
}

class PersonaConfirmacionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() nombres: string;
  @ApiProperty() apellidos: string;
}

class MiConfirmacionDto {
  @ApiProperty({ enum: EstadoConfirmacion }) estado: EstadoConfirmacion;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) respondida_en: Date | null;
}

class ConfirmacionIntegranteDto {
  @ApiProperty({ format: 'uuid' }) estudiante_id: string;
  @ApiProperty() nombres: string;
  @ApiProperty() apellidos: string;
  @ApiProperty({ enum: EstadoConfirmacion }) estado: EstadoConfirmacion;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) respondida_en: Date | null;
}

export class ConfirmacionPostulacionResponseDto {
  @ApiProperty({ format: 'uuid' }) postulacion_id: string;
  @ApiProperty({ format: 'uuid' }) periodo_id: string;
  @ApiProperty({ enum: EstadoPostulacion }) estado_postulacion: EstadoPostulacion;
  @ApiProperty({ type: String, format: 'date-time' }) fecha_postulacion: Date;
  @ApiProperty({ type: String, format: 'date-time', description: 'fecha_postulacion + RESERVA_CONFIRMACION_HORAS (48 h); el cierre de postulación también vence la reserva.' }) vence_en: Date;
  @ApiProperty({ type: TemaConfirmacionDto }) tema: TemaConfirmacionDto;
  @ApiProperty({ type: Object, nullable: true, description: 'null en postulaciones individuales.' }) grupo: { id: string; nombre: string } | null;
  @ApiProperty({ type: PersonaConfirmacionDto, description: 'Usuario que registró la postulación (representante).' }) representante: PersonaConfirmacionDto;
  @ApiProperty({ type: MiConfirmacionDto }) mi_confirmacion: MiConfirmacionDto;
  @ApiProperty({ type: [ConfirmacionIntegranteDto] }) confirmaciones: ConfirmacionIntegranteDto[];
}
