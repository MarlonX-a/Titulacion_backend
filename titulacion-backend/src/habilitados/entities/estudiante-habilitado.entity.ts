import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';
import { Estudiante } from '../../estudiantes/entities/estudiante.entity.js';
import { PeriodoTitulacion } from '../../periodos/entities/periodo-titulacion.entity.js';
import { LoteImportacion } from '../../importaciones/entities/lote-importacion.entity.js';
import { CondicionIngreso } from '../enums/condicion-ingreso.enum.js';
import { HabilitadoEstado } from '../enums/habilitado-estado.enum.js';
import { HabilitadoOrigen } from '../enums/habilitado-origen.enum.js';
import { SituacionIngreso } from '../enums/situacion-ingreso.enum.js';

@Entity({ name: 'estudiante_habilitado' })
@Index('UQ_estudiante_habilitado_periodo_estudiante', ['periodo', 'estudiante'], { unique: true })
@Check('CHK_habilitado_regular_requisito', `("condicion_ingreso" = 'REGULAR') = ("requisito_pendiente" IS NULL)`)
@Check('CHK_habilitado_requisito_no_vacio', `"requisito_pendiente" IS NULL OR length(btrim("requisito_pendiente")) > 0`)
@Check('CHK_habilitado_regular_situacion', `"condicion_ingreso" <> 'REGULAR' OR "situacion_ingreso" <> 'PENDIENTE'`)
@Check('CHK_habilitado_condicionado_resuelto', `"condicion_ingreso" <> 'CONDICIONADO' OR "situacion_ingreso" = 'PENDIENTE' OR ("fecha_resolucion_ingreso" IS NOT NULL AND "resuelto_por_id" IS NOT NULL)`)
@Check('CHK_habilitado_origen_lote', `("origen" = 'IMPORTACION') = ("lote_importacion_id" IS NOT NULL)`)
export class EstudianteHabilitado {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => PeriodoTitulacion, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'periodo_id', foreignKeyConstraintName: 'FK_habilitado_periodo' })
  periodo: PeriodoTitulacion;

  @ManyToOne(() => Estudiante, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'estudiante_id', foreignKeyConstraintName: 'FK_habilitado_estudiante' })
  estudiante: Estudiante;

  @Column({ type: 'enum', enum: HabilitadoOrigen, enumName: 'estudiante_habilitado_origen_enum' })
  origen: HabilitadoOrigen;

  @ManyToOne(() => LoteImportacion, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'lote_importacion_id', foreignKeyConstraintName: 'FK_habilitado_lote_importacion' })
  lote_importacion: LoteImportacion | null;

  @Column({ type: 'enum', enum: HabilitadoEstado, enumName: 'estudiante_habilitado_estado_enum' })
  estado: HabilitadoEstado;

  @Column({ type: 'enum', enum: CondicionIngreso, enumName: 'estudiante_habilitado_condicion_enum' })
  condicion_ingreso: CondicionIngreso;

  @Column({ type: 'text', name: 'requisito_pendiente', nullable: true })
  requisito_pendiente: string | null;

  @Column({ type: 'enum', enum: SituacionIngreso, enumName: 'estudiante_habilitado_situacion_enum' })
  situacion_ingreso: SituacionIngreso;

  @Column({ type: 'timestamptz', name: 'fecha_habilitacion', default: () => 'CURRENT_TIMESTAMP' })
  fecha_habilitacion: Date;

  @Column({ type: 'timestamptz', name: 'fecha_resolucion_ingreso', nullable: true })
  fecha_resolucion_ingreso: Date | null;

  @ManyToOne(() => Usuario, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'resuelto_por_id', foreignKeyConstraintName: 'FK_habilitado_resuelto_por' })
  resuelto_por: Usuario | null;

  @Column({ type: 'text', name: 'observacion_ingreso', nullable: true })
  observacion_ingreso: string | null;
}
