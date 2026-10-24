import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PeriodoTitulacion } from '../../periodos/entities/periodo-titulacion.entity.js';

@Entity({ name: 'archivo_limpieza_pendiente' })
@Index('UQ_archivo_limpieza_ruta', ['ruta_almacenamiento'], { unique: true })
@Index('IDX_archivo_limpieza_periodo_estado', ['periodo_id', 'estado', 'creado_en'])
export class ArchivoPendiente {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', name: 'periodo_id', nullable: true }) periodo_id: string | null;
  @ManyToOne(() => PeriodoTitulacion, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'periodo_id', foreignKeyConstraintName: 'FK_archivo_limpieza_periodo' }) periodo: PeriodoTitulacion | null;
  @Column({ type: 'varchar', length: 500, name: 'ruta_almacenamiento' }) ruta_almacenamiento: string;
  @Column({ type: 'varchar', length: 20, default: 'SUBIENDO' }) estado: 'SUBIENDO' | 'LIMPIEZA';
  @Column({ type: 'timestamptz', name: 'creado_en', default: () => 'CURRENT_TIMESTAMP' }) creado_en: Date;
}
