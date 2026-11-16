import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Carrera } from '../../academico/entities/carrera.entity.js';
import { Docente } from '../../docentes/entities/docente.entity.js';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';

/**
 * Programa de temas de una carrera (bloque 4, migración 20261115110000). Tiene exactamente un
 * responsable: un perfil DOCENTE o una cuenta COORDINADOR. `max_temas` limita sus temas no RETIRADOS.
 * El nombre es único por carrera sin distinguir mayúsculas (`UQ_programa_carrera_nombre`, índice de expresión en la migración).
 */
@Entity({ name: 'programa' })
@Index('IDX_programa_responsable_docente', ['responsable_docente_id'])
@Index('IDX_programa_responsable_usuario', ['responsable_usuario_id'])
@Check('CHK_programa_un_responsable', 'num_nonnulls("responsable_docente_id", "responsable_usuario_id") = 1')
@Check('CHK_programa_max_temas', '"max_temas" BETWEEN 1 AND 50')
@Check('CHK_programa_nombre_no_vacio', 'length(btrim("nombre")) > 0')
export class Programa {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 150 }) nombre: string;
  @Column({ type: 'text', nullable: true }) descripcion: string | null;
  @Column({ type: 'uuid', name: 'carrera_id' }) carrera_id: string;
  @ManyToOne(() => Carrera, { nullable: false, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'carrera_id', foreignKeyConstraintName: 'FK_programa_carrera' }) carrera?: Carrera;
  @Column({ type: 'uuid', name: 'responsable_docente_id', nullable: true }) responsable_docente_id: string | null;
  @ManyToOne(() => Docente, { nullable: true, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'responsable_docente_id', foreignKeyConstraintName: 'FK_programa_responsable_docente' }) responsable_docente?: Docente | null;
  @Column({ type: 'uuid', name: 'responsable_usuario_id', nullable: true }) responsable_usuario_id: string | null;
  @ManyToOne(() => Usuario, { nullable: true, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'responsable_usuario_id', foreignKeyConstraintName: 'FK_programa_responsable_usuario' }) responsable_usuario?: Usuario | null;
  @Column({ type: 'smallint', name: 'max_temas', default: 15 }) max_temas: number;
  @Column({ type: 'boolean', default: true }) activo: boolean;
  @Column({ type: 'timestamptz', name: 'creado_en', default: () => 'CURRENT_TIMESTAMP' }) creado_en: Date;
  @Column({ type: 'timestamptz', name: 'actualizado_en', default: () => 'CURRENT_TIMESTAMP' }) actualizado_en: Date;
}
