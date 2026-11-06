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
  `"cedula" IS NULL OR "cedula" ~ '^(0[1-9]|1[0-9]|2[0-4]|30)[0-9]{8}$'`,
)
@Check(
  'CHK_docente_titulo_academico_no_vacio',
  '"titulo_academico" IS NULL OR length(btrim("titulo_academico")) > 0',
)
@Check(
  'CHK_docente_departamento_no_vacio',
  '"departamento" IS NULL OR length(btrim("departamento")) > 0',
)
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

  @Column({ type: 'varchar', length: 20, nullable: true })
  cedula: string | null;

  @Column({ type: 'varchar', length: 120, name: 'titulo_academico', nullable: true })
  titulo_academico: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  departamento: string | null;

  @Column({ type: 'boolean', default: false, name: 'habilitado_tutoria' })
  habilitado_tutoria: boolean;
}
