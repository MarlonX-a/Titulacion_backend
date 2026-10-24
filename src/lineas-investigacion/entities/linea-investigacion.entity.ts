import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'linea_investigacion' })
@Index('UQ_linea_investigacion_codigo', ['codigo'], { unique: true })
@Check('CHK_linea_investigacion_codigo_no_vacio', 'length(btrim("codigo")) > 0')
@Check('CHK_linea_investigacion_nombre_no_vacio', 'length(btrim("nombre")) > 0')
@Check('CHK_linea_investigacion_descripcion_no_vacia', '"descripcion" IS NULL OR length(btrim("descripcion")) > 0')
export class LineaInvestigacion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20 })
  codigo: string;

  @Column({ type: 'varchar', length: 150 })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  @Column({ type: 'boolean', default: true })
  activa: boolean;
}
