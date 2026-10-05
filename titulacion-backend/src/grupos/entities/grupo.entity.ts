import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PeriodoTitulacion } from '../../periodos/entities/periodo-titulacion.entity.js';
import { GrupoEstado } from '../enums/grupo-estado.enum.js';

@Entity({ name: 'grupo' })
@Index('UQ_grupo_id_periodo', ['id', 'periodo'], { unique: true })
@Index('IDX_grupo_periodo_estado_creado', ['periodo', 'estado', 'creado_en'])
@Check('CHK_grupo_nombre_no_vacio', 'length(btrim("nombre")) > 0')
export class Grupo {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => PeriodoTitulacion, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'periodo_id', foreignKeyConstraintName: 'FK_grupo_periodo' })
  periodo: PeriodoTitulacion;

  @Column({ type: 'varchar', length: 120 })
  nombre: string;

  @Column({ type: 'enum', enum: GrupoEstado, enumName: 'grupo_estado_enum', default: GrupoEstado.EN_CONFORMACION })
  estado: GrupoEstado;

  @Column({ type: 'timestamptz', name: 'creado_en', default: () => 'CURRENT_TIMESTAMP' })
  creado_en: Date;
}
