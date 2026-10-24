import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ResolucionConflicto } from './resolucion-conflicto.entity.js';
import { Postulacion } from '../../postulaciones/entities/postulacion.entity.js';
import { Tema } from '../../temas/entities/tema.entity.js';

@Entity({ name: 'conflicto_participante' })
@Index('UQ_conflicto_participante_resolucion_postulacion', ['resolucion_conflicto_id', 'postulacion_id'], { unique: true })
export class ConflictoParticipante {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', name: 'resolucion_conflicto_id' }) resolucion_conflicto_id: string;
  @ManyToOne(() => ResolucionConflicto, { nullable: false, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'resolucion_conflicto_id' }) resolucion: ResolucionConflicto;
  @Column({ type: 'uuid', name: 'tema_id' }) tema_id: string;
  @ManyToOne(() => Tema, { nullable: false, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'tema_id' }) tema: Tema;
  @Column({ type: 'uuid', name: 'postulacion_id' }) postulacion_id: string;
  @ManyToOne(() => Postulacion, { nullable: false, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'postulacion_id' }) postulacion: Postulacion;
  @Column({ type: 'numeric', precision: 6, scale: 2, nullable: true, name: 'puntaje_criterio' }) puntaje_criterio: string | null;
}
