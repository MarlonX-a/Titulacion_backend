import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { SesionUsuario } from './sesion-usuario.entity.js';

@Entity({ name: 'sesion_refresh_hash' })
export class SesionRefreshHash {
  @PrimaryColumn('uuid', { name: 'sesion_id' })
  sesion_id: string;

  @ManyToOne(() => SesionUsuario, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sesion_id' })
  sesion: SesionUsuario;

  @PrimaryColumn({ type: 'char', length: 64, name: 'refresh_hash' })
  refresh_hash: string;

  @Column({ type: 'timestamptz', name: 'creada_en', default: () => 'CURRENT_TIMESTAMP' })
  creada_en: Date;

  @Column({ type: 'timestamptz', name: 'consumida_en', nullable: true })
  consumida_en: Date | null;
}
