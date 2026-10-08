import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Docente } from '../../docentes/entities/docente.entity.js';
import { PeriodoTitulacion } from '../../periodos/entities/periodo-titulacion.entity.js';

@Entity({ name: 'config_carga_tutorial' })
@Index('IDX_config_carga_tutorial_periodo', ['periodo_id', 'docente_id', 'id'])
@Check('CHK_config_carga_tutorial_max_trabajos', '"max_trabajos" >= 1')
export class ConfigCargaTutorial {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'periodo_id' })
  periodo_id: string;

  @ManyToOne(() => PeriodoTitulacion, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'periodo_id', foreignKeyConstraintName: 'FK_config_carga_tutorial_periodo' })
  periodo: PeriodoTitulacion;

  @Column({ type: 'uuid', name: 'docente_id', nullable: true })
  docente_id: string | null;

  @ManyToOne(() => Docente, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'docente_id', foreignKeyConstraintName: 'FK_config_carga_tutorial_docente' })
  docente: Docente | null;

  @Column({ type: 'smallint', name: 'max_trabajos' })
  max_trabajos: number;

  @Column({ type: 'boolean', name: 'bloquear_al_superar' })
  bloquear_al_superar: boolean;
}
