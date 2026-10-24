import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';
import { PeriodoTitulacion } from '../../periodos/entities/periodo-titulacion.entity.js';
import { LoteImportacion } from './lote-importacion.entity.js';
import { PreparacionImportacionEstado } from '../enums/preparacion-importacion-estado.enum.js';

@Entity({ name: 'preparacion_importacion' })
export class PreparacionImportacion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => PeriodoTitulacion, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'periodo_id' })
  periodo: PeriodoTitulacion;

  @ManyToOne(() => Usuario, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'solicitada_por_id' })
  solicitada_por: Usuario;

  @ManyToOne(() => LoteImportacion, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'lote_id' })
  lote: LoteImportacion | null;

  @Column({ type: 'varchar', length: 200, name: 'nombre_archivo' })
  nombre_archivo: string;

  @Column({ type: 'varchar', length: 500, name: 'ruta_almacenamiento' })
  ruta_almacenamiento: string;

  @Column({ type: 'char', length: 64, name: 'sha256' })
  sha256: string;

  @Column({ type: 'varchar', length: 24 })
  estado: PreparacionImportacionEstado;

  @Column({ type: 'inet', name: 'ip_origen', nullable: true })
  ip_origen: string | null;

  @Column({ type: 'integer', name: 'total_filas', default: 0 })
  total_filas: number;

  @Column({ type: 'jsonb', nullable: true })
  filas: unknown | null;

  @Column({ type: 'jsonb', nullable: true })
  errores: unknown | null;

  @Column({ type: 'timestamptz', name: 'creada_en', default: () => 'CURRENT_TIMESTAMP' })
  creada_en: Date;

  @Column({ type: 'timestamptz', name: 'expira_en' })
  expira_en: Date;
}
