import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, RelationId } from 'typeorm';
import { Estudiante } from '../../estudiantes/entities/estudiante.entity.js';
import { PeriodoTitulacion } from '../../periodos/entities/periodo-titulacion.entity.js';
import { Grupo } from '../../grupos/entities/grupo.entity.js';
import { InvitacionEstado } from '../enums/invitacion-estado.enum.js';

@Entity({ name: 'invitacion' })
@Index('UQ_invitacion_pendiente_grupo_destinatario', ['grupo', 'estudiante_destino'], { unique: true, where: '"estado" = \'PENDIENTE\'' })
@Index('IDX_invitacion_periodo_destino_fecha', ['periodo', 'estudiante_destino', 'fecha_envio'])
@Index('IDX_invitacion_grupo_fecha', ['grupo', 'fecha_envio'])
@Check('CHK_invitacion_distintos_estudiantes', '"estudiante_emisor_id" <> "estudiante_destino_id"')
@Check('CHK_invitacion_vencimiento', '"expira_en" > "fecha_envio"')
@Check('CHK_invitacion_estado_fecha_respuesta', '("estado" = \'PENDIENTE\' AND "fecha_respuesta" IS NULL) OR ("estado" <> \'PENDIENTE\' AND "fecha_respuesta" IS NOT NULL)')
export class Invitacion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Grupo, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'grupo_id', foreignKeyConstraintName: 'FK_invitacion_grupo' })
  grupo: Grupo;

  @RelationId((item: Invitacion) => item.grupo)
  grupo_id: string;

  @ManyToOne(() => PeriodoTitulacion, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'periodo_id', foreignKeyConstraintName: 'FK_invitacion_periodo' })
  periodo: PeriodoTitulacion;

  @RelationId((item: Invitacion) => item.periodo)
  periodo_id: string;

  @ManyToOne(() => Estudiante, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'estudiante_emisor_id', foreignKeyConstraintName: 'FK_invitacion_emisor' })
  estudiante_emisor: Estudiante;

  @RelationId((item: Invitacion) => item.estudiante_emisor)
  estudiante_emisor_id: string;

  @ManyToOne(() => Estudiante, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'estudiante_destino_id', foreignKeyConstraintName: 'FK_invitacion_destinatario' })
  estudiante_destino: Estudiante;

  @RelationId((item: Invitacion) => item.estudiante_destino)
  estudiante_destino_id: string;

  @Column({ type: 'enum', enum: InvitacionEstado, enumName: 'invitacion_estado_enum', default: InvitacionEstado.PENDIENTE })
  estado: InvitacionEstado;

  @Column({ type: 'timestamptz', name: 'fecha_envio', default: () => 'CURRENT_TIMESTAMP' })
  fecha_envio: Date;

  @Column({ type: 'timestamptz', name: 'expira_en' })
  expira_en: Date;

  @Column({ type: 'timestamptz', name: 'fecha_respuesta', nullable: true })
  fecha_respuesta: Date | null;
}
