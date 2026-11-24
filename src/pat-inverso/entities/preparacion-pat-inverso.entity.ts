import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { PatOficialExtraido } from '../parsear-pat-oficial.js';

/** Vista previa del Word oficial, vigente unas horas, al estilo de las importaciones. */
@Entity({ name: 'preparacion_pat_inverso' })
export class PreparacionPatInverso {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) periodo_id: string;
  @Column({ type: 'uuid' }) asignacion_tema_id: string;
  @Column({ type: 'uuid' }) estudiante_id: string;
  @Column({ type: 'uuid' }) creada_por_id: string;
  @Column({ type: 'varchar', length: 20 }) estado: 'PENDIENTE' | 'CONFIRMADA';
  @Column({ type: 'jsonb' }) extraido: PatOficialExtraido;
  @Column({ type: 'timestamptz' }) expira_en: Date;
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' }) creada_en: Date;
}
