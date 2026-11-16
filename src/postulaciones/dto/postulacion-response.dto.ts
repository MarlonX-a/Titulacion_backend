import { TipoTema } from '../../temas/enums/tipo-tema.enum.js';
import { ApiProperty } from '@nestjs/swagger';
import { EstadoPostulacion } from '../enums/estado-postulacion.enum.js';
import { EstadoConfirmacion } from '../enums/estado-confirmacion.enum.js';
import { TutorPropuestoResponseDto } from './tutores-propuestos.dto.js';

export class PagedPostulacionesResponseDto {
  @ApiProperty({ type: [Object] }) data: PostulacionResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}

export class PostulacionResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() periodo_id: string;
  @ApiProperty() tema_id: string;
  @ApiProperty({ type: Object, description: 'min/max derive from tipo and the max_integrantes_default of the application period.' }) tema: { id: string; titulo: string; tipo: TipoTema; min_integrantes: number; max_integrantes: number; estado: string };
  @ApiProperty({ nullable: true }) grupo_id: string | null;
  @ApiProperty({ nullable: true, type: Object }) grupo: { id: string; nombre: string } | null;
  @ApiProperty({ nullable: true }) estudiante_id: string | null;
  @ApiProperty({ type: [Object], description: 'Titular o integrantes activos del grupo. La matrícula solo se incluye para ADMIN o para el propio estudiante.' }) participantes: Array<{ id: string; nombres: string; apellidos: string; matricula?: string; habilitado: string | null; situacion_ingreso: string | null }>;
  @ApiProperty() num_integrantes: number;
  @ApiProperty() registrada_por_id: string;
  @ApiProperty({ type: Object }) registrada_por: { id: string; nombres: string; apellidos: string };
  @ApiProperty({ enum: EstadoPostulacion }) estado: EstadoPostulacion;
  @ApiProperty() fecha_postulacion: Date;
  @ApiProperty({ nullable: true }) observacion: string | null;
  @ApiProperty({ type: [TutorPropuestoResponseDto], description: 'Tutores propuestos ordenados por prioridad (cargados en lote).' }) tutores_propuestos: TutorPropuestoResponseDto[];
  @ApiProperty({ type: [Object], description: 'Respuesta de cada participante a la reserva (vacío en postulaciones anteriores a la confirmación obligatoria).' }) confirmaciones: Array<{ estudiante_id: string; nombres: string; apellidos: string; estado: EstadoConfirmacion; respondida_en: Date | null }>;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Vencimiento de la reserva; solo mientras la postulación está PENDIENTE_CONFIRMACION.' }) vence_en: Date | null;
}
