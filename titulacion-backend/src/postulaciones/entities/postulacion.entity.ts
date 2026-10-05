import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PeriodoTitulacion } from '../../periodos/entities/periodo-titulacion.entity.js';
import { Tema } from '../../temas/entities/tema.entity.js';
import { Grupo } from '../../grupos/entities/grupo.entity.js';
import { Estudiante } from '../../estudiantes/entities/estudiante.entity.js';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';
import { EstadoPostulacion } from '../enums/estado-postulacion.enum.js';

@Entity({ name: 'postulacion' })
@Index('IDX_postulacion_periodo_fecha', ['periodo', 'fecha_postulacion', 'id'])
@Check('CHK_postulacion_modalidad_exclusiva', '("grupo_id" IS NULL) <> ("estudiante_id" IS NULL)')
@Check('CHK_postulacion_num_integrantes', '("estudiante_id" IS NOT NULL AND "num_integrantes" = 1) OR ("grupo_id" IS NOT NULL AND "num_integrantes" >= 2)')
export class Postulacion {
  @PrimaryGeneratedColumn('uuid') id: string;
  @ManyToOne(() => Tema, { nullable: false, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'tema_id' }) tema: Tema;
  @ManyToOne(() => PeriodoTitulacion, { nullable: false, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'periodo_id' }) periodo: PeriodoTitulacion;
  @ManyToOne(() => Grupo, { nullable: true, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'grupo_id' }) grupo: Grupo | null;
  @ManyToOne(() => Estudiante, { nullable: true, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'estudiante_id' }) estudiante: Estudiante | null;
  @Column({ type: 'smallint', name: 'num_integrantes' }) num_integrantes: number;
  @ManyToOne(() => Usuario, { nullable: false, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'registrada_por_id' }) registrada_por: Usuario;
  @Column({ type: 'enum', enum: EstadoPostulacion, enumName: 'postulacion_estado_enum', default: EstadoPostulacion.PENDIENTE }) estado: EstadoPostulacion;
  @Column({ type: 'timestamptz', name: 'fecha_postulacion', default: () => 'CURRENT_TIMESTAMP' }) fecha_postulacion: Date;
  @Column({ type: 'text', nullable: true }) observacion: string | null;
}
