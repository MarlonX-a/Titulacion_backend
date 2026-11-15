import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { Estudiante } from '../../estudiantes/entities/estudiante.entity.js';

@Entity({ name: 'estudiante_datos_pat' })
export class EstudianteDatosPat {
  @PrimaryColumn({ type: 'uuid', name: 'estudiante_id' }) estudiante_id: string;
  @OneToOne(() => Estudiante, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'estudiante_id', foreignKeyConstraintName: 'FK_estudiante_datos_pat_estudiante' }) estudiante: Estudiante;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) datos: Record<string, unknown>;
  @Column({ type: 'timestamptz', name: 'actualizado_en', default: () => 'CURRENT_TIMESTAMP' }) actualizado_en: Date;
}
