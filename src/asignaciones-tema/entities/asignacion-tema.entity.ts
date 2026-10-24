import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Tema } from '../../temas/entities/tema.entity.js';
import { Postulacion } from '../../postulaciones/entities/postulacion.entity.js';
import { Grupo } from '../../grupos/entities/grupo.entity.js';
import { Estudiante } from '../../estudiantes/entities/estudiante.entity.js';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';
import { AsignacionTemaEstado } from '../enums/asignacion-tema-estado.enum.js';
import { AsignacionTemaCausa } from '../enums/asignacion-tema-causa.enum.js';

@Entity({ name: 'asignacion_tema' })
@Index('UQ_asignacion_tema_postulacion', ['postulacion_id'], { unique: true })
@Index('UQ_asignacion_tema_vigente_tema', ['tema_id'], { unique: true, where: '"estado" = \'VIGENTE\'' })
@Index('UQ_asignacion_tema_vigente_grupo', ['grupo_id'], { unique: true, where: '"estado" = \'VIGENTE\' AND "grupo_id" IS NOT NULL' })
@Index('UQ_asignacion_tema_vigente_estudiante', ['estudiante_id'], { unique: true, where: '"estado" = \'VIGENTE\' AND "estudiante_id" IS NOT NULL' })
@Index('IDX_asignacion_tema_periodo_fecha', ['periodo_id', 'fecha_asignacion', 'id'])
@Check('CHK_asignacion_tema_modalidad', '("grupo_id" IS NULL) <> ("estudiante_id" IS NULL)')
@Check('CHK_asignacion_tema_anulacion', '("estado" = \'VIGENTE\' AND "causa_anulacion" IS NULL AND "motivo_anulacion" IS NULL AND "anulada_por_id" IS NULL AND "fecha_anulacion" IS NULL) OR ("estado" = \'ANULADA\' AND "causa_anulacion" IS NOT NULL AND "motivo_anulacion" IS NOT NULL AND length(btrim("motivo_anulacion")) > 0 AND "anulada_por_id" IS NOT NULL AND "fecha_anulacion" IS NOT NULL)')
export class AsignacionTema {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', name: 'tema_id' }) tema_id: string;
  @ManyToOne(() => Tema, { nullable: false, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'tema_id' }) tema: Tema;
  @Column({ type: 'uuid', name: 'periodo_id' }) periodo_id: string;
  @Column({ type: 'uuid', name: 'postulacion_id' }) postulacion_id: string;
  @ManyToOne(() => Postulacion, { nullable: false, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'postulacion_id' }) postulacion: Postulacion;
  @Column({ type: 'uuid', name: 'grupo_id', nullable: true }) grupo_id: string | null;
  @ManyToOne(() => Grupo, { nullable: true, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'grupo_id' }) grupo: Grupo | null;
  @Column({ type: 'uuid', name: 'estudiante_id', nullable: true }) estudiante_id: string | null;
  @ManyToOne(() => Estudiante, { nullable: true, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'estudiante_id' }) estudiante: Estudiante | null;
  @Column({ type: 'uuid', name: 'aprobada_por_id' }) aprobada_por_id: string;
  @ManyToOne(() => Usuario, { nullable: false, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'aprobada_por_id' }) aprobada_por: Usuario;
  @Column({ type: 'enum', enum: AsignacionTemaEstado, enumName: 'asignacion_tema_estado_enum', default: AsignacionTemaEstado.VIGENTE }) estado: AsignacionTemaEstado;
  @Column({ type: 'timestamptz', name: 'fecha_asignacion', default: () => 'CURRENT_TIMESTAMP' }) fecha_asignacion: Date;
  @Column({ type: 'text' }) motivo: string;
  @Column({ type: 'enum', enum: AsignacionTemaCausa, enumName: 'asignacion_tema_causa_enum', name: 'causa_anulacion', nullable: true }) causa_anulacion: AsignacionTemaCausa | null;
  @Column({ type: 'text', name: 'motivo_anulacion', nullable: true }) motivo_anulacion: string | null;
  @Column({ type: 'uuid', name: 'anulada_por_id', nullable: true }) anulada_por_id: string | null;
  @ManyToOne(() => Usuario, { nullable: true, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'anulada_por_id' }) anulada_por: Usuario | null;
  @Column({ type: 'timestamptz', name: 'fecha_anulacion', nullable: true }) fecha_anulacion: Date | null;
}
