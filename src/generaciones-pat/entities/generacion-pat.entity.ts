import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AsignacionTema } from '../../asignaciones-tema/entities/asignacion-tema.entity.js';
import { Estudiante } from '../../estudiantes/entities/estudiante.entity.js';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';

@Entity({ name: 'generacion_pat' })
@Index('IDX_generacion_pat_estudiante_fecha', ['asignacion_tema_id', 'estudiante_id', 'solicitada_en'])
@Check('CHK_generacion_pat_version', '"version_diseno" > 0')
export class GeneracionPat {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', name: 'asignacion_tema_id' }) asignacion_tema_id: string;
  @ManyToOne(() => AsignacionTema, { nullable: false, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'asignacion_tema_id' }) asignacion_tema: AsignacionTema;
  @Column({ type: 'uuid', name: 'estudiante_id' }) estudiante_id: string;
  @ManyToOne(() => Estudiante, { nullable: false, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'estudiante_id' }) estudiante: Estudiante;
  @Column({ type: 'uuid', name: 'solicitada_por_id' }) solicitada_por_id: string;
  @ManyToOne(() => Usuario, { nullable: false, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'solicitada_por_id' }) solicitada_por: Usuario;
  @Column({ type: 'smallint', name: 'version_diseno', default: 1 }) version_diseno: number;
  @Column({ type: 'integer', default: 1 }) ciclo: number;
  @Column({ type: 'jsonb' }) instantanea: Record<string, unknown>;
  @Column({ type: 'varchar', length: 20, default: 'EN_COLA' }) estado: string;
  @Column({ type: 'varchar', length: 500, name: 'ruta_almacenamiento', nullable: true }) ruta_almacenamiento: string | null;
  @Column({ type: 'bigint', name: 'tamano_bytes', nullable: true }) tamano_bytes: string | null;
  @Column({ type: 'char', length: 64, name: 'hash_sha256', nullable: true }) hash_sha256: string | null;
  @Column({ type: 'varchar', length: 300, name: 'error_sanitizado', nullable: true }) error_sanitizado: string | null;
  @Column({ type: 'timestamptz', name: 'solicitada_en', default: () => 'CURRENT_TIMESTAMP' }) solicitada_en: Date;
  @Column({ type: 'timestamptz', name: 'generada_en', nullable: true }) generada_en: Date | null;
  /** Inicio del procesamiento del ciclo actual; detecta generaciones atascadas. */
  @Column({ type: 'timestamptz', name: 'procesando_desde', nullable: true }) procesando_desde: Date | null;
}
