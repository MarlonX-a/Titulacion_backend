import { ApiProperty } from '@nestjs/swagger';
import { TutoresPropuestosPatResponseDto } from './tutores-propuestos-pat.dto.js';

const FUENTES = ['USUARIO', 'ESTUDIANTE', 'ESTUDIANTE_NIVEL', 'CARRERA', 'FACULTAD', 'PERIODO', 'TEMA', 'LINEA_INVESTIGACION', 'ASIGNACION_TEMA', 'ASIGNACION_TUTOR', 'TUTOR_PROPUESTO_ELEGIDO', 'TUTOR_PROPUESTO_PREDETERMINADO', 'SIN_TUTOR', 'PREDETERMINADO', 'CONTENIDO_PAT'];

export class ValorAutomaticoPatDto {
  @ApiProperty({ description: 'Valor autocompletado (texto, número, objeto, lista o null).', nullable: true }) valor: unknown;
  @ApiProperty({ enum: FUENTES }) fuente: string;
}

export class ContenidoEditablePatDto {
  @ApiProperty() problematica: string;
  @ApiProperty({ description: 'true si el estudiante guardó su propio texto; false si es la descripción del tema.' }) problematica_personalizada: boolean;
  @ApiProperty() confirma_problematica: boolean;
  @ApiProperty({ type: [String], enum: ['INVESTIGACION', 'VINCULACION', 'DOCENCIA', 'NINGUNA'] }) articulaciones: string[];
  @ApiProperty({ format: 'uuid', nullable: true }) tutor_propuesto_id: string | null;
}

export class EditablesPatDto {
  @ApiProperty({ type: Object, description: 'Datos personales guardados (solo campos que aporta el estudiante).' }) personal: Record<string, unknown>;
  @ApiProperty({ type: ContenidoEditablePatDto }) contenido: ContenidoEditablePatDto;
}

export class ResumenPatResponseDto {
  @ApiProperty({ format: 'uuid' }) asignacion_tema_id: string;
  @ApiProperty({ format: 'uuid' }) estudiante_id: string;
  @ApiProperty({ type: 'object', additionalProperties: true, description: 'Cada clave es { valor, fuente } (ValorAutomaticoPatDto): nombres, apellidos, cedula, matricula, correo_institucional, carrera, facultad, periodo, extension_pat, nivel, curso, tema_titulo, problematica_sugerida, linea_investigacion, articulaciones_sugeridas, modalidad, tipo_tema, integrantes, modalidad_academica, tutor.' })
  automaticos: Record<string, ValorAutomaticoPatDto>;
  @ApiProperty({ type: EditablesPatDto }) editables: EditablesPatDto;
  @ApiProperty({ type: [String], description: 'Claves pendientes; las mismas del 400 de la generación.' }) pendientes: string[];
  @ApiProperty() listo_para_generar: boolean;
  @ApiProperty({ type: TutoresPropuestosPatResponseDto }) tutores_propuestos: TutoresPropuestosPatResponseDto;
}

export class GeneracionPatResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) asignacion_tema_id: string;
  @ApiProperty({ format: 'uuid' }) estudiante_id: string;
  @ApiProperty() version_diseno: number;
  @ApiProperty({ description: 'Aumenta con cada reintento o recuperación por atasco.' }) ciclo: number;
  @ApiProperty({ enum: ['EN_COLA', 'PROCESANDO', 'LISTO', 'FALLIDO'] }) estado: string;
  @ApiProperty({ nullable: true }) tamano_bytes: number | null;
  @ApiProperty({ nullable: true }) hash_sha256: string | null;
  @ApiProperty({ format: 'date-time' }) solicitada_en: Date;
  @ApiProperty({ format: 'date-time', nullable: true }) procesando_desde: Date | null;
  @ApiProperty({ format: 'date-time', nullable: true }) generada_en: Date | null;
  @ApiProperty({ nullable: true, description: 'Mensaje saneado; solo en FALLIDO.' }) error: string | null;
  @ApiProperty({ format: 'uuid', nullable: true, description: 'Entrega directa (origen GENERADO) creada desde esta generación.' }) documento_pat_id: string | null;
}

export class ListaGeneracionesPatResponseDto {
  @ApiProperty({ type: [GeneracionPatResponseDto] }) data: GeneracionPatResponseDto[];
  @ApiProperty() total: number;
}
