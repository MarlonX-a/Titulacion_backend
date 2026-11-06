import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Carrera } from '../../academico/entities/carrera.entity.js';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';

@Entity({ name: 'estudiante' })
@Index('UQ_estudiante_cedula', ['cedula'], { unique: true })
@Index('UQ_estudiante_matricula', ['matricula'], { unique: true })
@Index('IDX_estudiante_carrera', ['carrera_id'])
@Check(
  'CHK_estudiante_cedula_formato',
  `"cedula" ~ '^(0[1-9]|1[0-9]|2[0-4]|30)[0-9]{8}$'`,
)
@Check('CHK_estudiante_nivel_positivo', '"nivel" > 0')
@Check('CHK_estudiante_matricula_no_vacia', 'length(btrim("matricula")) > 0')
export class Estudiante {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Usuario, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'usuario_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'FK_estudiante_usuario',
  })
  usuario: Usuario;

  @Column({ type: 'varchar', length: 20 })
  cedula: string;

  @Column({ type: 'varchar', length: 20 })
  matricula: string;

  @Column({ type: 'uuid', name: 'carrera_id' })
  carrera_id: string;

  @ManyToOne(() => Carrera, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'carrera_id', foreignKeyConstraintName: 'FK_estudiante_carrera' })
  carrera?: Carrera;

  @Column({ type: 'smallint' })
  nivel: number;
}
