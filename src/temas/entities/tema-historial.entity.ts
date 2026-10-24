import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';
import { Tema } from './tema.entity.js';
import { EstadoTema } from '../enums/estado-tema.enum.js';

@Entity({ name: 'tema_historial' })
@Index('IDX_tema_historial_tema_fecha', ['tema', 'fecha', 'id'])
export class TemaHistorial {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Tema, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tema_id', foreignKeyConstraintName: 'FK_tema_historial_tema' })
  tema: Tema;

  @ManyToOne(() => Usuario, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'usuario_id', foreignKeyConstraintName: 'FK_tema_historial_usuario' })
  usuario: Usuario;

  @Column({ type: 'enum', enum: EstadoTema, enumName: 'tema_estado_enum', nullable: true, name: 'estado_anterior' })
  estado_anterior: EstadoTema | null;

  @Column({ type: 'enum', enum: EstadoTema, enumName: 'tema_estado_enum', name: 'estado_nuevo' })
  estado_nuevo: EstadoTema;

  @Column({ type: 'jsonb' })
  cambios: Record<string, unknown>;

  @Column({ type: 'timestamptz', name: 'fecha', default: () => 'CURRENT_TIMESTAMP' })
  fecha: Date;
}
