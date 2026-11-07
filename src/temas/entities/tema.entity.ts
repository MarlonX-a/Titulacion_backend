import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Carrera } from '../../academico/entities/carrera.entity.js';
import { Docente } from '../../docentes/entities/docente.entity.js';
import { LoteImportacion } from '../../importaciones/entities/lote-importacion.entity.js';
import { LineaInvestigacion } from '../../lineas-investigacion/entities/linea-investigacion.entity.js';
import { EstadoTema } from '../enums/estado-tema.enum.js';
import { TipoTema } from '../enums/tipo-tema.enum.js';

/** Topic of a career bank. It spans periods: the period of use lives in postulacion / asignacion_tema. */
@Entity({ name: 'tema' })
@Index('IDX_tema_carrera_creado', ['carrera_id', 'creado_en', 'id'])
@Index('IDX_tema_docente', ['docente_proponente', 'creado_en', 'id'])
@Index('IDX_tema_linea', ['linea', 'creado_en', 'id'])
@Index('IDX_tema_carrera', ['carrera_id'])
@Index('IDX_tema_lote_importacion', ['lote_importacion_id'])
@Check('CHK_tema_titulo_no_vacio', 'length(btrim("titulo")) > 0')
@Check('CHK_tema_descripcion_no_vacia', 'length(btrim("descripcion")) > 0')
export class Tema {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => LineaInvestigacion, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'linea_id', foreignKeyConstraintName: 'FK_tema_linea' })
  linea: LineaInvestigacion;

  @ManyToOne(() => Docente, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'docente_proponente_id', foreignKeyConstraintName: 'FK_tema_docente_proponente' })
  docente_proponente: Docente;

  @Column({ type: 'uuid', name: 'carrera_id' })
  carrera_id: string;

  @ManyToOne(() => Carrera, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'carrera_id', foreignKeyConstraintName: 'FK_tema_carrera' })
  carrera?: Carrera;

  @Column({ type: 'enum', enum: TipoTema, enumName: 'tema_tipo_enum' })
  tipo: TipoTema;

  @Column({ type: 'varchar', length: 250 })
  titulo: string;

  @Column({ type: 'text' })
  descripcion: string;

  @Column({ type: 'enum', enum: EstadoTema, enumName: 'tema_estado_enum', default: EstadoTema.BORRADOR })
  estado: EstadoTema;

  /** Import batch that created the topic; null for topics registered by hand. */
  @Column({ type: 'uuid', name: 'lote_importacion_id', nullable: true })
  lote_importacion_id: string | null;

  @ManyToOne(() => LoteImportacion, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'lote_importacion_id', foreignKeyConstraintName: 'FK_tema_lote_importacion' })
  lote_importacion?: LoteImportacion | null;

  @Column({ type: 'timestamptz', name: 'creado_en', default: () => 'CURRENT_TIMESTAMP' })
  creado_en: Date;
}
