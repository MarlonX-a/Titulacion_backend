import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { AsignacionTema } from '../../asignaciones-tema/entities/asignacion-tema.entity.js';
import { Docente } from '../../docentes/entities/docente.entity.js';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';

/**
 * Docente candidato a tutor de un equipo administrativo (asignación de tema con origen ADMIN), en
 * orden de prioridad. Es historial: no se modifica ni elimina (`proteger_candidato_tutor`).
 * No reutiliza `tutor_propuesto`, que pertenece a una postulación.
 */
@Entity({ name: 'candidato_tutor' })
@Unique('UQ_candidato_tutor_trabajo_docente', ['asignacion_tema_id', 'docente_id'])
@Unique('UQ_candidato_tutor_trabajo_prioridad', ['asignacion_tema_id', 'prioridad'])
@Unique('UQ_candidato_tutor_referencia', ['id', 'asignacion_tema_id', 'docente_id'])
@Index('IDX_candidato_tutor_docente', ['docente_id'])
@Check('CHK_candidato_tutor_prioridad', '"prioridad" BETWEEN 1 AND 10')
export class CandidatoTutor {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'uuid', name: 'asignacion_tema_id' }) asignacion_tema_id: string;
  @ManyToOne(() => AsignacionTema, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'asignacion_tema_id', foreignKeyConstraintName: 'FK_candidato_tutor_trabajo' })
  asignacion_tema?: AsignacionTema;

  @Column({ type: 'uuid', name: 'docente_id' }) docente_id: string;
  @ManyToOne(() => Docente, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'docente_id', foreignKeyConstraintName: 'FK_candidato_tutor_docente' })
  docente?: Docente;

  @Column({ type: 'smallint' }) prioridad: number;

  @Column({ type: 'uuid', name: 'registrado_por_id' }) registrado_por_id: string;
  @ManyToOne(() => Usuario, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'registrado_por_id', foreignKeyConstraintName: 'FK_candidato_tutor_responsable' })
  registrado_por?: Usuario;

  @Column({ type: 'timestamptz', name: 'creado_en', default: () => 'CURRENT_TIMESTAMP' }) creado_en: Date;
}
