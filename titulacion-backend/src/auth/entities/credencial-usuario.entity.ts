import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';

@Entity({ name: 'credencial_usuario' })
export class CredencialUsuario {
  @PrimaryColumn('uuid', { name: 'usuario_id' })
  usuario_id: string;

  @OneToOne(() => Usuario, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'usuario_id' })
  usuario: Usuario;

  @Column({ type: 'text', name: 'password_hash', nullable: true })
  password_hash: string | null;

  @Column({ type: 'boolean', name: 'requiere_cambio', default: true })
  requiere_cambio: boolean;

  @Column({ type: 'timestamptz', name: 'temporal_expira_en', nullable: true })
  temporal_expira_en: Date | null;

  @Column({ type: 'integer', name: 'version_sesion', default: 0 })
  version_sesion: number;

  @Column({ type: 'timestamptz', name: 'actualizada_en', default: () => 'CURRENT_TIMESTAMP' })
  actualizada_en: Date;
}
