import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';
import { PeriodoTitulacion } from '../../periodos/entities/periodo-titulacion.entity.js';
import { LoteImportacionEstado } from '../enums/lote-importacion-estado.enum.js';
import { LoteImportacionTipo } from '../enums/lote-importacion-tipo.enum.js';

@Entity({ name: 'lote_importacion' })
@Check('CHK_lote_importacion_contadores', '"total_filas" >= 0 AND "filas_ok" >= 0 AND "filas_error" >= 0')
@Check('CHK_lote_importacion_total_finalizado', '"estado" = \'EN_PROCESO\' OR ("filas_ok" + "filas_error" = "total_filas")')
@Check('CHK_lote_importacion_periodo_estudiantes', '"tipo" <> \'ESTUDIANTES\' OR "periodo_id" IS NOT NULL')
@Check('CHK_lote_importacion_fechas', '("estado" = \'EN_PROCESO\' AND "fecha_fin" IS NULL) OR ("estado" <> \'EN_PROCESO\' AND "fecha_fin" IS NOT NULL)')
export class LoteImportacion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => PeriodoTitulacion, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'periodo_id', foreignKeyConstraintName: 'FK_lote_importacion_periodo' })
  periodo: PeriodoTitulacion | null;

  @ManyToOne(() => Usuario, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ejecutado_por_id', foreignKeyConstraintName: 'FK_lote_importacion_usuario' })
  ejecutado_por: Usuario;

  @Column({ type: 'enum', enum: LoteImportacionTipo, enumName: 'lote_importacion_tipo_enum' })
  tipo: LoteImportacionTipo;

  @Column({ type: 'varchar', length: 200, name: 'nombre_archivo' })
  nombre_archivo: string;

  @Column({ type: 'varchar', length: 500, name: 'ruta_almacenamiento' })
  ruta_almacenamiento: string;

  @Column({ type: 'enum', enum: LoteImportacionEstado, enumName: 'lote_importacion_estado_enum' })
  estado: LoteImportacionEstado;

  @Column({ type: 'integer', name: 'total_filas' })
  total_filas: number;

  @Column({ type: 'integer', name: 'filas_ok' })
  filas_ok: number;

  @Column({ type: 'integer', name: 'filas_error' })
  filas_error: number;

  @Column({ type: 'jsonb', nullable: true })
  errores: unknown | null;

  @Column({ type: 'timestamptz', name: 'fecha_inicio' })
  fecha_inicio: Date;

  @Column({ type: 'timestamptz', name: 'fecha_fin', nullable: true })
  fecha_fin: Date | null;
}
