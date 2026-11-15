import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { AsignacionTema } from '../../asignaciones-tema/entities/asignacion-tema.entity.js';
import { Estudiante } from '../../estudiantes/entities/estudiante.entity.js';

@Entity({ name: 'contenido_pat_estudiante' })
@Unique('UQ_contenido_pat_asignacion_estudiante', ['asignacion_tema_id', 'estudiante_id'])
export class ContenidoPatEstudiante {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', name: 'asignacion_tema_id' }) asignacion_tema_id: string;
  @ManyToOne(() => AsignacionTema, { nullable: false, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'asignacion_tema_id' }) asignacion_tema: AsignacionTema;
  @Column({ type: 'uuid', name: 'estudiante_id' }) estudiante_id: string;
  @ManyToOne(() => Estudiante, { nullable: false, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'estudiante_id' }) estudiante: Estudiante;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) contenido: Record<string, unknown>;
  @Column({ type: 'timestamptz', name: 'actualizado_en', default: () => 'CURRENT_TIMESTAMP' }) actualizado_en: Date;
}
