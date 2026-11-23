import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';

/** Copia cifrada de una clave temporal, solo para su entrega controlada por ADMIN. */
@Entity({ name: 'clave_temporal_visible' })
export class ClaveTemporalVisible {
  @PrimaryColumn('uuid', { name: 'usuario_id' })
  usuario_id: string;

  @OneToOne(() => Usuario, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'usuario_id' })
  usuario: Usuario;

  @Column({ type: 'text', name: 'secreto_cifrado' })
  secreto_cifrado: string;

  @Column({ type: 'varchar', length: 24 })
  nonce: string;

  @Column({ type: 'varchar', length: 32 })
  tag: string;

  @Column({ type: 'timestamptz', name: 'expira_en' })
  expira_en: Date;

  @Column({ type: 'timestamptz', name: 'actualizada_en', default: () => 'CURRENT_TIMESTAMP' })
  actualizada_en: Date;
}
