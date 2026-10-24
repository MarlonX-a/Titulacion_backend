import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AsignacionTema } from '../../asignaciones-tema/entities/asignacion-tema.entity.js';
import { Docente } from '../../docentes/entities/docente.entity.js';
import { TutorPropuesto } from '../../postulaciones/entities/tutor-propuesto.entity.js';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';
import { AsignacionTutorEstado } from '../enums/asignacion-tutor-estado.enum.js';
import { AsignacionTutorTipo } from '../enums/asignacion-tutor-tipo.enum.js';

@Entity({ name: 'asignacion_tutor' })
@Index('UQ_asignacion_tutor_vigente_trabajo', ['asignacion_tema_id'], { unique: true, where: '"estado" = \'VIGENTE\'' })
@Index('IDX_asignacion_tutor_docente_estado', ['docente_id', 'estado', 'fecha_asignacion'])
@Check('CHK_asignacion_tutor_tipo_propuesta', '("tipo" = \'PROPUESTO_CONFIRMADO\' AND "tutor_propuesto_id" IS NOT NULL) OR ("tipo" = \'ASIGNADO_DIRECTO\' AND "tutor_propuesto_id" IS NULL)')
@Check('CHK_asignacion_tutor_estado_fecha_fin', '("estado" = \'VIGENTE\' AND "fecha_fin" IS NULL AND "motivo_cambio" IS NULL) OR ("estado" IN (\'REEMPLAZADA\', \'ANULADA\') AND "fecha_fin" IS NOT NULL AND "motivo_cambio" IS NOT NULL AND length(btrim("motivo_cambio")) BETWEEN 1 AND 1000)')
@Check('CHK_asignacion_tutor_cronologia', '"fecha_fin" IS NULL OR "fecha_fin" >= "fecha_asignacion"')
export class AsignacionTutor {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'uuid', name: 'asignacion_tema_id' }) asignacion_tema_id: string;
  @ManyToOne(() => AsignacionTema, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'asignacion_tema_id', foreignKeyConstraintName: 'FK_asignacion_tutor_trabajo' })
  asignacion_tema: AsignacionTema;

  @Column({ type: 'uuid', name: 'docente_id' }) docente_id: string;
  @ManyToOne(() => Docente, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'docente_id', foreignKeyConstraintName: 'FK_asignacion_tutor_docente' })
  docente: Docente;

  @Column({ type: 'uuid', name: 'tutor_propuesto_id', nullable: true }) tutor_propuesto_id: string | null;
  @ManyToOne(() => TutorPropuesto, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tutor_propuesto_id', foreignKeyConstraintName: 'FK_asignacion_tutor_propuesta' })
  tutor_propuesto: TutorPropuesto | null;

  @Column({ type: 'enum', enum: AsignacionTutorTipo, enumName: 'asignacion_tutor_tipo_enum' }) tipo: AsignacionTutorTipo;
  @Column({ type: 'enum', enum: AsignacionTutorEstado, enumName: 'asignacion_tutor_estado_enum', default: AsignacionTutorEstado.VIGENTE }) estado: AsignacionTutorEstado;

  @Column({ type: 'uuid', name: 'asignada_por_id' }) asignada_por_id: string;
  @ManyToOne(() => Usuario, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'asignada_por_id', foreignKeyConstraintName: 'FK_asignacion_tutor_responsable' })
  asignada_por: Usuario;

  @Column({ type: 'timestamptz', name: 'fecha_asignacion', default: () => 'CURRENT_TIMESTAMP' }) fecha_asignacion: Date;
  @Column({ type: 'timestamptz', name: 'fecha_fin', nullable: true }) fecha_fin: Date | null;
  @Column({ type: 'text', name: 'motivo_cambio', nullable: true }) motivo_cambio: string | null;
}
