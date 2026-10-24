import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';

@Entity({ name: 'solicitud_recuperacion' })
export class SolicitudRecuperacion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'usuario_id' })
  usuario_id: string;

  @ManyToOne(() => Usuario, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'usuario_id' })
  usuario: Usuario;

  @Column({ type: 'char', length: 64, name: 'codigo_hash' })
  codigo_hash: string;

  @Column({ type: 'timestamptz', name: 'expira_en' })
  expira_en: Date;

  @Column({ type: 'timestamptz', name: 'usada_en', nullable: true })
  usada_en: Date | null;
}
