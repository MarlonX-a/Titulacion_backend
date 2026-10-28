import { ApiProperty } from '@nestjs/swagger';

const conteo = (description: string) => ({ type: 'object', additionalProperties: { type: 'integer' }, description }) as const;

export class ResumenPeriodoResponseDto {
  @ApiProperty({ format: 'uuid' }) periodo_id: string;
  @ApiProperty({ description: 'Habilitaciones del período en cualquier estado.' }) estudiantes_habilitados: number;
  @ApiProperty({ description: 'Habilitaciones CONDICIONADO con ingreso PENDIENTE.' }) condicionados_pendientes: number;
  @ApiProperty(conteo('Habilitaciones por estado (HABILITADO, SUSPENDIDO).')) habilitados_por_estado: Record<string, number>;
  @ApiProperty(conteo('Habilitaciones por condición de ingreso (REGULAR, CONDICIONADO).')) habilitados_por_condicion: Record<string, number>;
  @ApiProperty(conteo('Habilitaciones por situación de ingreso (PENDIENTE, ADMITIDO, NO_ADMITIDO).')) habilitados_por_situacion: Record<string, number>;
  @ApiProperty(conteo('Temas por estado; incluye todos los estados con 0.')) temas_por_estado: Record<string, number>;
  @ApiProperty(conteo('Postulaciones por estado; incluye todos los estados con 0.')) postulaciones_por_estado: Record<string, number>;
  @ApiProperty({ description: 'Temas con dos o más candidaturas elegibles y sin resolución (mismo criterio que GET .../conflictos?estado=SIN_RESOLVER).' }) conflictos_abiertos: number;
  @ApiProperty({ description: 'Asignaciones de tema VIGENTE.' }) asignaciones_vigentes: number;
  @ApiProperty({ description: 'Asignaciones VIGENTE con tutor VIGENTE.' }) tutores_asignados: number;
  @ApiProperty({ description: 'Asignaciones VIGENTE sin tutor VIGENTE.' }) sin_tutor: number;
  @ApiProperty({ description: 'Asignaciones VIGENTE cuya última versión PAT no tiene revisión.' }) pat_por_revisar: number;
  @ApiProperty(conteo('Estado de la última versión PAT de cada asignación VIGENTE (PENDIENTE, APROBADO, OBSERVADO, RECHAZADO, SIN_ENTREGA).')) pat_por_estado: Record<string, number>;
}
