import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';

@Entity({ name: 'docente' })
@Index('UQ_docente_cedula', ['cedula'], { unique: true })
@Check(
  'CHK_docente_cedula_formato',
  `"cedula" ~ '^(0[1-9]|1[0-9]|2[0-4]|30)[0-9]{8}$'`,
)
@Check(
  'CHK_docente_titulo_academico_no_vacio',
  'length(btrim("titulo_academico")) > 0',
)
@Check('CHK_docente_departamento_no_vacio', 'length(btrim("departamento")) > 0')
export class Docente {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Usuario, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'usuario_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'FK_docente_usuario',
  })
  usuario: Usuario;

  @Column({ type: 'varchar', length: 20 })
  cedula: string;

  @Column({ type: 'varchar', length: 120, name: 'titulo_academico' })
  titulo_academico: string;

  @Column({ type: 'varchar', length: 120 })
  departamento: string;

  @Column({ type: 'boolean', default: false, name: 'habilitado_tutoria' })
  habilitado_tutoria: boolean;
}
