import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AsignacionTema } from '../../asignaciones-tema/entities/asignacion-tema.entity.js';
import { PlantillaPat } from '../../plantillas-pat/entities/plantilla-pat.entity.js';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';
import { DocumentoPatFormato } from '../enums/documento-pat-formato.enum.js';

@Entity({ name: 'documento_pat' })
@Index('UQ_documento_pat_asignacion_version', ['asignacion_tema_id', 'version'], { unique: true })
@Index('IDX_documento_pat_asignacion_version', ['asignacion_tema_id', 'version'])
@Check('CHK_documento_pat_version', '"version" >= 1')
@Check('CHK_documento_pat_nombre_no_vacio', 'length(btrim("nombre_archivo")) > 0')
@Check('CHK_documento_pat_ruta_no_vacia', 'length(btrim("ruta_almacenamiento")) > 0')
@Check('CHK_documento_pat_tamano_positivo', '"tamano_bytes" > 0')
@Check('CHK_documento_pat_hash_sha256', '"hash_sha256" ~ \'^[a-f0-9]{64}$\'')
export class DocumentoPat {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', name: 'asignacion_tema_id' }) asignacion_tema_id: string;
  @ManyToOne(() => AsignacionTema, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'asignacion_tema_id', foreignKeyConstraintName: 'FK_documento_pat_asignacion' }) asignacion_tema: AsignacionTema;
  @Column({ type: 'uuid', name: 'plantilla_id' }) plantilla_id: string;
  @ManyToOne(() => PlantillaPat, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'plantilla_id', foreignKeyConstraintName: 'FK_documento_pat_plantilla' }) plantilla: PlantillaPat;
  @Column({ type: 'smallint' }) version: number;
  @Column({ type: 'varchar', length: 200, name: 'nombre_archivo' }) nombre_archivo: string;
  @Column({ type: 'varchar', length: 500, name: 'ruta_almacenamiento' }) ruta_almacenamiento: string;
  @Column({ type: 'enum', enum: DocumentoPatFormato, enumName: 'documento_pat_formato_enum' }) formato: DocumentoPatFormato;
  @Column({ type: 'bigint', name: 'tamano_bytes' }) tamano_bytes: string;
  @Column({ type: 'char', length: 64, name: 'hash_sha256' }) hash_sha256: string;
  @Column({ type: 'uuid', name: 'cargado_por_id' }) cargado_por_id: string;
  @ManyToOne(() => Usuario, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'cargado_por_id', foreignKeyConstraintName: 'FK_documento_pat_cargador' }) cargado_por: Usuario;
  @Column({ type: 'timestamptz', name: 'fecha_carga', default: () => 'CURRENT_TIMESTAMP' }) fecha_carga: Date;
}
