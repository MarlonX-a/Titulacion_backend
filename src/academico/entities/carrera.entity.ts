import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Facultad } from './facultad.entity.js';

@Entity({ name: 'carrera' })
@Index('UQ_carrera_codigo', ['codigo'], { unique: true })
@Index('UQ_carrera_facultad_nombre', ['facultad_id', 'nombre'], { unique: true })
export class Carrera {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 80 })
  codigo: string;

  @Column({ type: 'varchar', length: 150 })
  nombre: string;

  @Column({ type: 'uuid', name: 'facultad_id' })
  facultad_id: string;

  @ManyToOne(() => Facultad, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'facultad_id', foreignKeyConstraintName: 'FK_carrera_facultad' })
  facultad?: Facultad;
}
