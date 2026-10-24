import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';
import { NotificacionCanal, NotificacionTipo } from '../enums/notificacion-canal.enum.js';

@Entity({ name: 'notificacion' })
@Index('UQ_notificacion_destinatario_evento_canal', ['usuario_id', 'tipo', 'entidad_tipo', 'entidad_id', 'canal'], { unique: true })
@Index('IDX_notificacion_bandeja', ['usuario_id', 'canal', 'fecha_creacion'])
@Index('IDX_notificacion_no_leidas', ['usuario_id', 'fecha_creacion'], { where: '"canal" = \'EN_APP\' AND "leida" = false' })
@Check('CHK_notificacion_tipo_pat', `"tipo" IN (${Object.values(NotificacionTipo).map((value) => `'${value}'`).join(',')})`)
@Check('CHK_notificacion_entidad_pat', `("tipo"='PAT_ENTREGADO' AND "entidad_tipo"='documento_pat') OR ("tipo"='PAT_REVISADO' AND "entidad_tipo"='revision_pat') OR ("tipo" LIKE 'INVITACION_%' AND "entidad_tipo"='invitacion') OR ("tipo" LIKE 'POSTULACION_%' AND "entidad_tipo"='postulacion') OR ("tipo" IN ('TEMA_ASIGNADO','TEMA_ANULADO') AND "entidad_tipo"='asignacion_tema') OR ("tipo" IN ('TUTOR_ASIGNADO','TUTOR_REEMPLAZADO') AND "entidad_tipo"='asignacion_tutor') OR ("tipo"='INGRESO_RESUELTO' AND "entidad_tipo"='estudiante_habilitado')`)
@Check('CHK_notificacion_texto', 'length(btrim("titulo")) > 0 AND length(btrim("mensaje")) > 0')
@Check('CHK_notificacion_envio_app', '"canal" <> \'EN_APP\' OR "fecha_envio" IS NOT NULL')
@Check('CHK_notificacion_email_no_leida', '"canal" <> \'EMAIL\' OR "leida"=false')
export class Notificacion {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', name: 'usuario_id' }) usuario_id: string;
  @ManyToOne(() => Usuario, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'usuario_id', foreignKeyConstraintName: 'FK_notificacion_usuario' }) usuario: Usuario;
  @Column({ type: 'varchar', length: 60 }) tipo: string;
  @Column({ type: 'varchar', length: 200 }) titulo: string;
  @Column({ type: 'text' }) mensaje: string;
  @Column({ type: 'varchar', length: 60, name: 'entidad_tipo' }) entidad_tipo: string;
  @Column({ type: 'uuid', name: 'entidad_id' }) entidad_id: string;
  @Column({ type: 'enum', enum: NotificacionCanal, enumName: 'notificacion_canal_enum' }) canal: NotificacionCanal;
  @Column({ type: 'boolean', default: false }) leida: boolean;
  @Column({ type: 'timestamptz', name: 'fecha_creacion', default: () => 'CURRENT_TIMESTAMP' }) fecha_creacion: Date;
  @Column({ type: 'timestamptz', name: 'fecha_envio', nullable: true }) fecha_envio: Date | null;
}
