import { Check, Column, Entity, JoinColumn, ManyToOne, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { DocumentoPat } from '../../documentos-pat/entities/documento-pat.entity.js';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';
import { RevisionPatResultado } from '../enums/revision-pat-resultado.enum.js';

@Entity({ name: 'revision_pat' })
@Check('CHK_revision_pat_observaciones', '"resultado" = \'APROBADO\' OR ("observaciones" IS NOT NULL AND length(btrim("observaciones")) > 0)')
export class RevisionPat {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', name: 'documento_pat_id', unique: true }) documento_pat_id: string;
  @OneToOne(() => DocumentoPat, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'documento_pat_id', foreignKeyConstraintName: 'FK_revision_pat_documento' }) documento_pat: DocumentoPat;
  @Column({ type: 'uuid', name: 'revisor_id' }) revisor_id: string;
  @ManyToOne(() => Usuario, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'revisor_id', foreignKeyConstraintName: 'FK_revision_pat_revisor' }) revisor: Usuario;
  @Column({ type: 'enum', enum: RevisionPatResultado, enumName: 'revision_pat_resultado_enum' }) resultado: RevisionPatResultado;
  @Column({ type: 'text', nullable: true }) observaciones: string | null;
  @Column({ type: 'timestamptz', name: 'fecha_revision', default: () => 'CURRENT_TIMESTAMP' }) fecha_revision: Date;
}
