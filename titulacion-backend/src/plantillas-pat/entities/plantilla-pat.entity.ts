import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PeriodoTitulacion } from '../../periodos/entities/periodo-titulacion.entity.js';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';

@Entity({ name: 'plantilla_pat' })
@Index('UQ_plantilla_pat_periodo_version', ['periodo_id', 'version'], { unique: true })
@Index('UQ_plantilla_pat_activa_periodo', ['periodo_id'], { unique: true, where: '"activa" = true' })
@Index('IDX_plantilla_pat_periodo_vigencia', ['periodo_id', 'fecha_vigencia_inicio', 'id'])
@Check('CHK_plantilla_pat_version_no_vacia', 'length(btrim("version")) > 0')
@Check('CHK_plantilla_pat_nombre_no_vacio', 'length(btrim("nombre_archivo")) > 0')
@Check('CHK_plantilla_pat_ruta_no_vacia', 'length(btrim("ruta_almacenamiento")) > 0')
@Check('CHK_plantilla_pat_mime_no_vacio', 'length(btrim("mime_type")) > 0')
@Check('CHK_plantilla_pat_tamano_positivo', '"tamano_bytes" > 0')
@Check('CHK_plantilla_pat_hash_sha256', '"hash_sha256" ~ \'^[a-f0-9]{64}$\'')
@Check('CHK_plantilla_pat_vigencia', '"fecha_vigencia_fin" IS NULL OR "fecha_vigencia_fin" >= "fecha_vigencia_inicio"')
export class PlantillaPat {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', name: 'periodo_id' }) periodo_id: string;
  @ManyToOne(() => PeriodoTitulacion, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'periodo_id', foreignKeyConstraintName: 'FK_plantilla_pat_periodo' }) periodo: PeriodoTitulacion;
  @Column({ type: 'varchar', length: 20 }) version: string;
  @Column({ type: 'varchar', length: 200, name: 'nombre_archivo' }) nombre_archivo: string;
  @Column({ type: 'varchar', length: 500, name: 'ruta_almacenamiento' }) ruta_almacenamiento: string;
  @Column({ type: 'varchar', length: 100, name: 'mime_type' }) mime_type: string;
  @Column({ type: 'bigint', name: 'tamano_bytes' }) tamano_bytes: string;
  @Column({ type: 'char', length: 64, name: 'hash_sha256' }) hash_sha256: string;
  @Column({ type: 'date', name: 'fecha_vigencia_inicio' }) fecha_vigencia_inicio: string;
  @Column({ type: 'date', name: 'fecha_vigencia_fin', nullable: true }) fecha_vigencia_fin: string | null;
  @Column({ type: 'uuid', name: 'publicada_por_id' }) publicada_por_id: string;
  @ManyToOne(() => Usuario, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'publicada_por_id', foreignKeyConstraintName: 'FK_plantilla_pat_publicada_por' }) publicada_por: Usuario;
  @Column({ type: 'boolean', default: true }) activa: boolean;
}
