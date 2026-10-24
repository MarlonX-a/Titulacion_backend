import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Tema } from '../../temas/entities/tema.entity.js';
import { PeriodoTitulacion } from '../../periodos/entities/periodo-titulacion.entity.js';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';
import { CriterioConflicto } from '../enums/criterio-conflicto.enum.js';

@Entity({ name: 'resolucion_conflicto' })
@Index('UQ_resolucion_conflicto_tema', ['tema'], { unique: true })
@Index('UQ_resolucion_conflicto_id_tema', ['id', 'tema'], { unique: true })
@Check('CHK_resolucion_conflicto_justificacion', 'length(btrim("justificacion")) > 0')
export class ResolucionConflicto {
  @PrimaryGeneratedColumn('uuid') id: string;
  @ManyToOne(() => Tema, { nullable: false, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'tema_id' }) tema: Tema;
  @ManyToOne(() => PeriodoTitulacion, { nullable: false, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'periodo_id' }) periodo: PeriodoTitulacion;
  @ManyToOne(() => Usuario, { nullable: false, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'resuelto_por_id' }) resuelto_por: Usuario;
  @Column({ type: 'enum', enum: CriterioConflicto, enumName: 'resolucion_conflicto_criterio_enum' }) criterio_aplicado: CriterioConflicto;
  @Column({ type: 'uuid', name: 'postulacion_ganadora_id' }) postulacion_ganadora_id: string;
  @Column({ type: 'text' }) justificacion: string;
  @Column({ type: 'timestamptz', name: 'fecha_resolucion', default: () => 'CURRENT_TIMESTAMP' }) fecha_resolucion: Date;
}
