import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Estudiante } from '../../estudiantes/entities/estudiante.entity.js';
import { EstadoConfirmacion } from '../enums/estado-confirmacion.enum.js';
import { Postulacion } from './postulacion.entity.js';

/** Respuesta de un participante a una postulación que reserva un tema (migración 20261115100000). */
@Entity({ name: 'postulacion_confirmacion' })
@Unique('UQ_postulacion_confirmacion_estudiante', ['postulacion_id', 'estudiante_id'])
@Index('IDX_postulacion_confirmacion_estudiante', ['estudiante_id', 'estado'])
@Check('CHK_postulacion_confirmacion_respuesta', `("estado" = 'PENDIENTE') = ("respondida_en" IS NULL)`)
export class PostulacionConfirmacion {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', name: 'postulacion_id' }) postulacion_id: string;
  @ManyToOne(() => Postulacion, { nullable: false, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'postulacion_id', foreignKeyConstraintName: 'FK_postulacion_confirmacion_postulacion' }) postulacion?: Postulacion;
  @Column({ type: 'uuid', name: 'estudiante_id' }) estudiante_id: string;
  @ManyToOne(() => Estudiante, { nullable: false, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'estudiante_id', foreignKeyConstraintName: 'FK_postulacion_confirmacion_estudiante' }) estudiante?: Estudiante;
  @Column({ type: 'enum', enum: EstadoConfirmacion, enumName: 'postulacion_confirmacion_estado_enum', default: EstadoConfirmacion.PENDIENTE }) estado: EstadoConfirmacion;
  @Column({ type: 'text', nullable: true }) motivo: string | null;
  @Column({ type: 'timestamptz', name: 'respondida_en', nullable: true }) respondida_en: Date | null;
  @Column({ type: 'timestamptz', name: 'creado_en', default: () => 'CURRENT_TIMESTAMP' }) creado_en: Date;
}
