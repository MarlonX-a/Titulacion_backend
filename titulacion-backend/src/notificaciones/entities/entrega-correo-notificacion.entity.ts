import { Check, Column, Entity, Index, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Notificacion } from './notificacion.entity.js';
import { EntregaCorreoEstado } from '../enums/entrega-correo-estado.enum.js';

@Entity({ name: 'entrega_correo_notificacion' })
@Index('UQ_entrega_correo_notificacion', ['notificacion_id'], { unique: true })
@Index('IDX_entrega_correo_notificacion_pendiente', ['estado', 'creada_en'], { where: '"estado" IN (\'PENDIENTE\',\'FALLIDO\',\'PROCESANDO\')' })
@Check('CHK_entrega_correo_notificacion_intentos', '"intentos" >= 0')
@Check('CHK_entrega_correo_notificacion_estado', '("estado"=\'PROCESANDO\') = ("reserva_hasta" IS NOT NULL) AND (("estado"=\'ENVIADO\') = ("enviada_en" IS NOT NULL))')
export class EntregaCorreoNotificacion {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', name: 'notificacion_id' }) notificacion_id: string;
  @OneToOne(() => Notificacion, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'notificacion_id', foreignKeyConstraintName: 'FK_entrega_correo_notificacion_notificacion' }) notificacion: Notificacion;
  @Column({ type: 'enum', enum: EntregaCorreoEstado, enumName: 'entrega_correo_estado_enum', default: EntregaCorreoEstado.PENDIENTE }) estado: EntregaCorreoEstado;
  @Column({ type: 'integer', default: 0 }) intentos: number;
  @Column({ type: 'timestamptz', name: 'creada_en', default: () => 'CURRENT_TIMESTAMP' }) creada_en: Date;
  @Column({ type: 'timestamptz', name: 'actualizada_en', default: () => 'CURRENT_TIMESTAMP' }) actualizada_en: Date;
  @Column({ type: 'timestamptz', name: 'reserva_hasta', nullable: true }) reserva_hasta: Date | null;
  @Column({ type: 'text', name: 'ultimo_error', nullable: true }) ultimo_error: string | null;
  @Column({ type: 'timestamptz', name: 'enviada_en', nullable: true }) enviada_en: Date | null;
}
