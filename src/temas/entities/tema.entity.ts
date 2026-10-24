import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Docente } from '../../docentes/entities/docente.entity.js';
import { LineaInvestigacion } from '../../lineas-investigacion/entities/linea-investigacion.entity.js';
import { PeriodoTitulacion } from '../../periodos/entities/periodo-titulacion.entity.js';
import { EstadoTema } from '../enums/estado-tema.enum.js';

@Entity({ name: 'tema' })
@Index('IDX_tema_periodo_creado', ['periodo', 'creado_en', 'id'])
@Index('IDX_tema_docente', ['docente_proponente', 'creado_en', 'id'])
@Index('IDX_tema_linea', ['linea', 'creado_en', 'id'])
@Check('CHK_tema_titulo_no_vacio', 'length(btrim("titulo")) > 0')
@Check('CHK_tema_descripcion_no_vacia', 'length(btrim("descripcion")) > 0')
@Check('CHK_tema_min_integrantes', '"min_integrantes" >= 1')
@Check('CHK_tema_max_integrantes', '"max_integrantes" >= "min_integrantes"')
export class Tema {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => PeriodoTitulacion, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'periodo_id', foreignKeyConstraintName: 'FK_tema_periodo' })
  periodo: PeriodoTitulacion;

  @ManyToOne(() => LineaInvestigacion, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'linea_id', foreignKeyConstraintName: 'FK_tema_linea' })
  linea: LineaInvestigacion;

  @ManyToOne(() => Docente, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'docente_proponente_id', foreignKeyConstraintName: 'FK_tema_docente_proponente' })
  docente_proponente: Docente;

  @Column({ type: 'varchar', length: 250 })
  titulo: string;

  @Column({ type: 'text' })
  descripcion: string;

  @Column({ type: 'smallint', name: 'min_integrantes' })
  min_integrantes: number;

  @Column({ type: 'smallint', name: 'max_integrantes' })
  max_integrantes: number;

  @Column({ type: 'enum', enum: EstadoTema, enumName: 'tema_estado_enum', default: EstadoTema.BORRADOR })
  estado: EstadoTema;

  @Column({ type: 'timestamptz', name: 'creado_en', default: () => 'CURRENT_TIMESTAMP' })
  creado_en: Date;
}
