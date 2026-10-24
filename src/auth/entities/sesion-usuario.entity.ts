import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';

@Entity({ name: 'sesion_usuario' })
@Index('IDX_sesion_usuario_usuario', ['usuario_id'])
export class SesionUsuario {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'usuario_id' })
  usuario_id: string;

  @ManyToOne(() => Usuario, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'usuario_id' })
  usuario: Usuario;

  @Column({ type: 'char', length: 64, name: 'refresh_hash' })
  refresh_hash: string;

  @Column({ type: 'char', length: 64, name: 'refresh_anterior_hash', nullable: true })
  refresh_anterior_hash: string | null;

  @Column({ type: 'timestamptz', name: 'expira_en' })
  expira_en: Date;

  @Column({ type: 'timestamptz', name: 'revocada_en', nullable: true })
  revocada_en: Date | null;

  @Column({ type: 'timestamptz', name: 'creada_en', default: () => 'CURRENT_TIMESTAMP' })
  creada_en: Date;
}
