import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Estudiante } from '../../estudiantes/entities/estudiante.entity.js';
import { PeriodoTitulacion } from '../../periodos/entities/periodo-titulacion.entity.js';
import { Grupo } from './grupo.entity.js';
import { GrupoIntegranteEstado } from '../enums/grupo-integrante-estado.enum.js';
import { GrupoIntegranteRol } from '../enums/grupo-integrante-rol.enum.js';

@Entity({ name: 'grupo_integrante' })
@Index('UQ_grupo_integrante_grupo_estudiante', ['grupo', 'estudiante'], { unique: true })
@Index('UQ_grupo_integrante_periodo_estudiante_activo', ['periodo', 'estudiante'], { unique: true, where: '"estado" = \'ACTIVO\'' })
@Index('UQ_grupo_integrante_representante_activo', ['grupo'], { unique: true, where: '"rol_en_grupo" = \'REPRESENTANTE\' AND "estado" = \'ACTIVO\'' })
@Index('IDX_grupo_integrante_grupo_estado', ['grupo', 'estado'])
@Check('CHK_grupo_integrante_estado_salida', '("estado" = \'ACTIVO\') = ("fecha_salida" IS NULL)')
@Check('CHK_grupo_integrante_motivo_salida', '"motivo_salida" IS NULL OR length(btrim("motivo_salida")) > 0')
export class GrupoIntegrante {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Grupo, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'grupo_id', foreignKeyConstraintName: 'FK_grupo_integrante_grupo' })
  grupo: Grupo;

  @ManyToOne(() => PeriodoTitulacion, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'periodo_id', foreignKeyConstraintName: 'FK_grupo_integrante_periodo' })
  periodo: PeriodoTitulacion;

  @ManyToOne(() => Estudiante, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'estudiante_id', foreignKeyConstraintName: 'FK_grupo_integrante_estudiante' })
  estudiante: Estudiante;

  @Column({ type: 'enum', enum: GrupoIntegranteRol, enumName: 'grupo_integrante_rol_enum', name: 'rol_en_grupo' })
  rol_en_grupo: GrupoIntegranteRol;

  @Column({ type: 'enum', enum: GrupoIntegranteEstado, enumName: 'grupo_integrante_estado_enum', default: GrupoIntegranteEstado.ACTIVO })
  estado: GrupoIntegranteEstado;

  @Column({ type: 'timestamptz', name: 'fecha_ingreso', default: () => 'CURRENT_TIMESTAMP' })
  fecha_ingreso: Date;

  @Column({ type: 'timestamptz', name: 'fecha_salida', nullable: true })
  fecha_salida: Date | null;

  @Column({ type: 'text', name: 'motivo_salida', nullable: true })
  motivo_salida: string | null;
}
