import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'facultad' })
@Index('UQ_facultad_codigo', ['codigo'], { unique: true })
@Index('UQ_facultad_nombre', ['nombre'], { unique: true })
export class Facultad {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 80 })
  codigo: string;

  @Column({ type: 'varchar', length: 150 })
  nombre: string;
}
