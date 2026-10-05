import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Docente } from '../../docentes/entities/docente.entity.js';
import { Postulacion } from './postulacion.entity.js';

@Entity({ name: 'tutor_propuesto' })
@Unique('UQ_tutor_propuesto_postulacion_docente', ['postulacion', 'docente'])
@Unique('UQ_tutor_propuesto_postulacion_prioridad', ['postulacion', 'orden_prioridad'])
@Unique('UQ_tutor_propuesto_id_docente', ['id', 'docente'])
@Check('CHK_tutor_propuesto_prioridad_positiva', '"orden_prioridad" >= 1')
export class TutorPropuesto {
  @PrimaryGeneratedColumn('uuid') id: string;

  @ManyToOne(() => Postulacion, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'postulacion_id' }) postulacion: Postulacion;

  @ManyToOne(() => Docente, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'docente_id' }) docente: Docente;

  @Column({ type: 'smallint', name: 'orden_prioridad' }) orden_prioridad: number;
}
