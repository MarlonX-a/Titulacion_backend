import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';

@Entity({ name: 'correo_salida' })
export class CorreoSalida {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'usuario_id' })
  usuario_id: string;

  @ManyToOne(() => Usuario, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'usuario_id' })
  usuario: Usuario;

  @Column({ type: 'varchar', length: 20 })
  tipo: 'ACCESO' | 'RECUPERACION';

  @Column({ type: 'text', name: 'secreto_cifrado' })
  secreto_cifrado: string;

  @Column({ type: 'varchar', length: 32 })
  nonce: string;

  @Column({ type: 'varchar', length: 32 })
  tag: string;

  @Column({ type: 'timestamptz', name: 'expira_en' })
  expira_en: Date;

  @Column({ type: 'timestamptz', name: 'enviado_en', nullable: true })
  enviado_en: Date | null;

  @Column({ type: 'integer', default: 0 })
  intentos: number;

  @Column({ type: 'timestamptz', name: 'creada_en', default: () => 'CURRENT_TIMESTAMP' })
  creada_en: Date;
}
