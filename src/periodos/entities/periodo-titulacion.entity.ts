import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { PeriodoEstado } from '../enums/periodo-estado.enum.js';

@Entity({ name: 'periodo_titulacion' })
@Index('UQ_periodo_titulacion_codigo', ['codigo'], { unique: true })
@Check(
  'CHK_periodo_titulacion_inicio_fin_postulacion',
  '"fecha_fin_postulacion" > "fecha_inicio_postulacion"',
)
@Check(
  'CHK_periodo_titulacion_inicio_titulacion',
  '"fecha_inicio_titulacion" >= "fecha_fin_postulacion"',
)
@Check('CHK_periodo_titulacion_max_integrantes', '"max_integrantes_default" >= 1')
@Check('CHK_periodo_titulacion_codigo_no_vacio', 'length(btrim("codigo")) > 0')
@Check('CHK_periodo_titulacion_nombre_no_vacio', 'length(btrim("nombre")) > 0')
export class PeriodoTitulacion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20 })
  codigo: string;

  @Column({ type: 'varchar', length: 120 })
  nombre: string;

  @Column({ type: 'timestamptz', name: 'fecha_inicio_postulacion' })
  fecha_inicio_postulacion: Date;

  @Column({ type: 'timestamptz', name: 'fecha_fin_postulacion' })
  fecha_fin_postulacion: Date;

  @Column({ type: 'timestamptz', name: 'fecha_inicio_titulacion' })
  fecha_inicio_titulacion: Date;

  @Column({
    type: 'enum',
    enum: PeriodoEstado,
    enumName: 'periodo_titulacion_estado_enum',
    default: PeriodoEstado.BORRADOR,
  })
  estado: PeriodoEstado;

  @Column({ type: 'smallint', name: 'max_integrantes_default' })
  max_integrantes_default: number;
}
