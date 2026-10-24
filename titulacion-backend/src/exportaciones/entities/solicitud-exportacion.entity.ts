import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PeriodoTitulacion } from '../../periodos/entities/periodo-titulacion.entity.js';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';
import { ExportacionEstado } from '../enums/exportacion-estado.enum.js';
import { ExportacionFormato } from '../enums/exportacion-formato.enum.js';
import { ExportacionTipo } from '../enums/exportacion-tipo.enum.js';

@Entity({ name: 'solicitud_exportacion' })
@Index('IDX_solicitud_exportacion_usuario_fecha', ['solicitante_id', 'fecha_solicitud', 'id'])
@Index('IDX_solicitud_exportacion_estado_proxima', ['estado', 'proxima_ejecucion', 'fecha_solicitud'])
@Check('CHK_solicitud_exportacion_filtros_objeto', "jsonb_typeof(\"filtros\") = 'object'")
@Check('CHK_solicitud_exportacion_tamano', '"tamano_bytes" IS NULL OR "tamano_bytes" > 0')
@Check('CHK_solicitud_exportacion_hash', '"hash_sha256" IS NULL OR "hash_sha256" ~ \'^[a-f0-9]{64}$\'')
@Check('CHK_solicitud_exportacion_fechas', '"fecha_generacion" IS NULL OR "fecha_generacion" >= "fecha_solicitud"')
@Check('CHK_solicitud_exportacion_listo', '"estado" <> \'LISTO\' OR ("ruta_almacenamiento" IS NOT NULL AND "tamano_bytes" > 0 AND "hash_sha256" IS NOT NULL AND "fecha_generacion" IS NOT NULL AND "expira_en" IS NOT NULL)')
@Check('CHK_solicitud_exportacion_reserva', '("estado" = \'PROCESANDO\') = ("reserva_id" IS NOT NULL AND "reserva_expira_en" IS NOT NULL)')
export class SolicitudExportacion {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', name: 'periodo_id' }) periodo_id: string;
  @ManyToOne(() => PeriodoTitulacion, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'periodo_id', foreignKeyConstraintName: 'FK_solicitud_exportacion_periodo' }) periodo: PeriodoTitulacion;
  @Column({ type: 'uuid', name: 'solicitante_id' }) solicitante_id: string;
  @ManyToOne(() => Usuario, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'solicitante_id', foreignKeyConstraintName: 'FK_solicitud_exportacion_solicitante' }) solicitante: Usuario;
  @Column({ type: 'enum', enum: ExportacionTipo, enumName: 'solicitud_exportacion_tipo_enum' }) tipo_reporte: ExportacionTipo;
  @Column({ type: 'enum', enum: ExportacionFormato, enumName: 'solicitud_exportacion_formato_enum' }) formato: ExportacionFormato;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) filtros: Record<string, unknown>;
  @Column({ type: 'enum', enum: ExportacionEstado, enumName: 'solicitud_exportacion_estado_enum', default: ExportacionEstado.EN_COLA }) estado: ExportacionEstado;
  @Column({ type: 'varchar', length: 500, name: 'ruta_almacenamiento', nullable: true }) ruta_almacenamiento: string | null;
  @Column({ type: 'bigint', name: 'tamano_bytes', nullable: true }) tamano_bytes: string | null;
  @Column({ type: 'char', length: 64, name: 'hash_sha256', nullable: true }) hash_sha256: string | null;
  @Column({ type: 'boolean', name: 'archivo_limpiado', default: false }) archivo_limpiado: boolean;
  @Column({ type: 'timestamptz', name: 'expira_en', nullable: true }) expira_en: Date | null;
  @Column({ type: 'timestamptz', name: 'fecha_solicitud', default: () => 'CURRENT_TIMESTAMP' }) fecha_solicitud: Date;
  @Column({ type: 'timestamptz', name: 'fecha_generacion', nullable: true }) fecha_generacion: Date | null;
  @Column({ type: 'integer', default: 1 }) ciclo: number;
  @Column({ type: 'smallint', default: 0 }) intentos: number;
  @Column({ type: 'timestamptz', name: 'proxima_ejecucion', default: () => 'CURRENT_TIMESTAMP' }) proxima_ejecucion: Date;
  @Column({ type: 'uuid', name: 'reserva_id', nullable: true }) reserva_id: string | null;
  @Column({ type: 'timestamptz', name: 'reserva_expira_en', nullable: true }) reserva_expira_en: Date | null;
  @Column({ type: 'varchar', length: 300, name: 'error_sanitizado', nullable: true }) error_sanitizado: string | null;
}
