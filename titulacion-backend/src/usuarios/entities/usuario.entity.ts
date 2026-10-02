import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { UsuarioEstado } from '../enums/usuario-estado.enum.js';
import { UsuarioRol } from '../enums/usuario-rol.enum.js';

@Entity({ name: 'usuario' })
@Index('UQ_usuario_email', ['email'], { unique: true })
@Index('UQ_usuario_id_externo_sso', ['id_externo_sso'], { unique: true })
@Check('CHK_usuario_email_normalizado', '"email" = lower(btrim("email"))')
@Check('CHK_usuario_nombres_no_vacios', 'length(btrim("nombres")) > 0')
@Check('CHK_usuario_apellidos_no_vacios', 'length(btrim("apellidos")) > 0')
@Check(
  'CHK_usuario_id_externo_sso_no_vacio',
  'length(btrim("id_externo_sso")) > 0',
)
export class Usuario {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  email: string;

  @Column({ type: 'varchar', length: 100 })
  nombres: string;

  @Column({ type: 'varchar', length: 100 })
  apellidos: string;

  @Column({ type: 'enum', enum: UsuarioRol, enumName: 'usuario_rol_enum' })
  rol: UsuarioRol;

  @Column({
    type: 'enum',
    enum: UsuarioEstado,
    enumName: 'usuario_estado_enum',
    default: UsuarioEstado.ACTIVO,
  })
  estado: UsuarioEstado;

  @Column({ type: 'varchar', length: 100, name: 'id_externo_sso' })
  id_externo_sso: string;

  @Column({ type: 'timestamptz', name: 'ultimo_acceso', nullable: true })
  ultimo_acceso: Date | null;

  @Column({
    type: 'timestamptz',
    name: 'creado_en',
    default: () => 'CURRENT_TIMESTAMP',
  })
  creado_en: Date;
}
