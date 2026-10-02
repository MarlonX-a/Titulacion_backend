import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';

@Entity({ name: 'auditoria' })
export class Auditoria {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @ManyToOne(() => Usuario, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'usuario_id', foreignKeyConstraintName: 'FK_auditoria_usuario' })
  usuario: Usuario;

  @Column({ type: 'varchar', length: 60 })
  accion: string;

  @Column({ type: 'varchar', length: 60, name: 'entidad_tipo' })
  entidad_tipo: string;

  @Column({ type: 'uuid', name: 'entidad_id' })
  entidad_id: string;

  @Column({ type: 'jsonb', name: 'valores_anteriores', nullable: true })
  valores_anteriores: Record<string, unknown> | null;

  @Column({ type: 'jsonb', name: 'valores_nuevos', nullable: true })
  valores_nuevos: Record<string, unknown> | null;

  @Column({ type: 'inet', name: 'ip_origen', nullable: true })
  ip_origen: string | null;

  @Column({ type: 'timestamptz', name: 'fecha_hora', default: () => 'CURRENT_TIMESTAMP' })
  fecha_hora: Date;
}
