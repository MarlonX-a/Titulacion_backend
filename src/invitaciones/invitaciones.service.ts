import { ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { HabilitadosService } from '../habilitados/habilitados.service.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { Grupo } from '../grupos/entities/grupo.entity.js';
import { GrupoEstado } from '../grupos/enums/grupo-estado.enum.js';
import { GrupoIntegranteEstado } from '../grupos/enums/grupo-integrante-estado.enum.js';
import { GrupoIntegrante } from '../grupos/entities/grupo-integrante.entity.js';
import { GruposService } from '../grupos/grupos.service.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { CreateInvitacionDto } from './dto/create-invitacion.dto.js';
import { InvitacionResponseDto, PagedInvitacionesResponseDto } from './dto/invitacion-response.dto.js';
import { ListInvitacionesQueryDto } from './dto/list-invitaciones-query.dto.js';
import { Invitacion } from './entities/invitacion.entity.js';
import { InvitacionEstado } from './enums/invitacion-estado.enum.js';
import { PostulacionPersistenciaService } from '../postulaciones/postulacion-persistencia.service.js';
import { NotificacionesPersistenciaService } from '../notificaciones/notificaciones-persistencia.service.js';
import { NotificacionTipo } from '../notificaciones/enums/notificacion-canal.enum.js';

interface DriverError { code?: string; }
const relations = { periodo: true, grupo: true, estudiante_emisor: { usuario: true }, estudiante_destino: { usuario: true } } as const;
function person(student: Estudiante) { return { id: student.id, nombres: student.usuario.nombres, apellidos: student.usuario.apellidos, matricula: student.matricula }; }
function response(record: Invitacion): InvitacionResponseDto {
  const expired = record.estado === InvitacionEstado.PENDIENTE && record.expira_en.getTime() <= Date.now();
  return {
    id: record.id, grupo_id: record.grupo.id, periodo_id: record.periodo.id,
    grupo: { id: record.grupo.id, nombre: record.grupo.nombre, estado: record.grupo.estado },
    estudiante_emisor_id: record.estudiante_emisor.id, estudiante_emisor: person(record.estudiante_emisor),
    estudiante_destino_id: record.estudiante_destino.id, estudiante_destino: person(record.estudiante_destino),
    estado: expired ? InvitacionEstado.EXPIRADA : record.estado,
    fecha_envio: record.fecha_envio, expira_en: record.expira_en, fecha_respuesta: record.fecha_respuesta,
  };
}

@Injectable()
export class InvitacionesService {
  constructor(
    @InjectRepository(Invitacion) private readonly invitations: Repository<Invitacion>,
    @InjectRepository(Estudiante) private readonly students: Repository<Estudiante>,
    private readonly dataSource: DataSource,
    private readonly groups: GruposService,
    private readonly habilitados: HabilitadosService,
    private readonly auditoria: AuditoriaService,
    private readonly postulaciones: PostulacionPersistenciaService,
    private readonly notificaciones: NotificacionesPersistenciaService,
  ) {}

  async create(periodoId: string, grupoId: string, actor: Usuario, dto: CreateInvitacionDto, ip: string | null): Promise<InvitacionResponseDto> {
    try {
      const id = await this.dataSource.transaction(async (manager) => {
        const period = await this.groups.lockOpenPeriod(manager, periodoId);
        const group = await this.groups.lockGroup(manager, periodoId, grupoId);
        if (await this.postulaciones.grupoTienePostulaciones(manager, group.id)) throw new ConflictException('La composición del grupo está cerrada desde su primera postulación.');
        const senderId = await this.groups.studentIdForUser(manager, actor.id);
        await this.groups.assertRepresentative(manager, group.id, senderId);
        await this.groups.assertCurrentMembersEligible(manager, periodoId, group.id);
        if (await this.groups.countActiveMembers(manager, group.id) >= period.max_integrantes_default) throw new ConflictException('El grupo ya alcanzó el máximo de integrantes del período.');
        const targetId = dto.estudiante_destino_id;
        if (senderId === targetId) throw new ConflictException('No puedes invitarte a ti mismo.');
        await this.habilitados.getEligibleStudentForGroup(periodoId, targetId, manager);
        await this.groups.assertNoActiveMembership(manager, periodoId, targetId);
        await this.groups.assertNeverMemberOfGroup(manager, group.id, targetId);
        const targetAlreadyInGroup = await manager.getRepository(GrupoIntegrante).findOne({ where: { grupo: { id: group.id }, estudiante: { id: targetId }, estado: GrupoIntegranteEstado.ACTIVO } });
        if (targetAlreadyInGroup) throw new ConflictException('El estudiante ya forma parte de este grupo.');
        const existing = await manager.getRepository(Invitacion).findOne({ where: { grupo: { id: group.id }, estudiante_destino: { id: targetId }, estado: InvitacionEstado.PENDIENTE } });
        if (existing && existing.expira_en.getTime() > Date.now()) throw new ConflictException('Ya existe una invitación pendiente para este estudiante.');
        if (existing) {
          existing.estado = InvitacionEstado.EXPIRADA;
          existing.fecha_respuesta = existing.expira_en;
          await manager.getRepository(Invitacion).save(existing);
          await this.auditoria.registrar(manager, { actor, accion: 'REGISTRAR_EXPIRACION_INVITACION', entidad_tipo: 'invitacion', entidad_id: existing.id, valores_anteriores: { estado: InvitacionEstado.PENDIENTE }, valores_nuevos: { estado: InvitacionEstado.EXPIRADA, fecha_respuesta: existing.expira_en }, ip_origen: ip });
          await this.notificaciones.invitacion(manager, existing.id, NotificacionTipo.INVITACION_EXPIRADA, actor.id);
        }
        const repo = manager.getRepository(Invitacion);
        this.groups.assertApplicationWindow(period);
        const now = new Date();
        const item = await repo.save(repo.create({ grupo: group, periodo: period, estudiante_emisor: { id: senderId } as Estudiante, estudiante_destino: { id: targetId } as Estudiante, estado: InvitacionEstado.PENDIENTE, fecha_envio: now, expira_en: period.fecha_fin_postulacion, fecha_respuesta: null }));
        await this.auditoria.registrar(manager, { actor, accion: 'ENVIAR_INVITACION_GRUPO', entidad_tipo: 'invitacion', entidad_id: item.id, valores_anteriores: null, valores_nuevos: { grupo_id: group.id, periodo_id: periodoId, estudiante_emisor_id: senderId, estudiante_destino_id: targetId, estado: item.estado, expira_en: item.expira_en }, ip_origen: ip });
        await this.notificaciones.invitacion(manager, item.id, NotificacionTipo.INVITACION_RECIBIDA, actor.id);
        return item.id;
      });
      return await this.getOne(periodoId, id);
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async listSent(periodoId: string, grupoId: string, actor: Usuario, isAdmin: boolean, query: ListInvitacionesQueryDto): Promise<PagedInvitacionesResponseDto> {
    try {
      const group = await this.invitations.manager.getRepository(Grupo).findOne({ where: { id: grupoId, periodo: { id: periodoId } } });
      if (!group) throw new NotFoundException('No existe ese grupo en el período indicado.');
      if (!isAdmin) {
        const sender = await this.groups.studentIdForUser(this.invitations.manager, actor.id);
        await this.groups.assertRepresentative(this.invitations.manager, group.id, sender);
      }
      return this.listBy({ periodoId, grupoId }, query);
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async listReceived(periodoId: string, actor: Usuario, query: ListInvitacionesQueryDto): Promise<PagedInvitacionesResponseDto> {
    try {
      const period = await this.dataSource.getRepository(PeriodoTitulacion).findOne({ where: { id: periodoId } });
      if (!period) throw new NotFoundException('No existe el período indicado.');
      const student = await this.students.findOne({ where: { usuario: { id: actor.id } } });
      if (!student) throw new NotFoundException('No tienes perfil de estudiante.');
      return this.listBy({ periodoId, destinoId: student.id }, query);
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async accept(periodoId: string, id: string, actor: Usuario, ip: string | null): Promise<InvitacionResponseDto> {
    const result = await this.resolve(periodoId, id, actor, ip, InvitacionEstado.ACEPTADA);
    if (result.expired) throw new ConflictException('La invitación venció y ya no puede aceptarse.');
    return result.item;
  }

  async reject(periodoId: string, id: string, actor: Usuario, ip: string | null): Promise<InvitacionResponseDto> {
    const result = await this.resolve(periodoId, id, actor, ip, InvitacionEstado.RECHAZADA);
    if (result.expired) throw new ConflictException('La invitación venció y ya no puede rechazarse.');
    return result.item;
  }

  async cancel(periodoId: string, id: string, actor: Usuario, ip: string | null): Promise<InvitacionResponseDto> {
    const result = await this.resolve(periodoId, id, actor, ip, InvitacionEstado.CANCELADA);
    if (result.expired) throw new ConflictException('La invitación venció y ya no puede cancelarse.');
    return result.item;
  }

  private async resolve(periodoId: string, id: string, actor: Usuario, ip: string | null, state: InvitacionEstado) {
    try {
      const outcome = await this.dataSource.transaction(async (manager): Promise<{ expired: boolean; id: string }> => {
        const period = await this.groups.lockPeriod(manager, periodoId);
        const inviteRepo = manager.getRepository(Invitacion);
        const candidate = await inviteRepo.findOne({ where: { id, periodo: { id: periodoId } }, relations: { grupo: true } });
        if (!candidate) throw new NotFoundException('No existe esa invitación en el período indicado.');
        const actorStudentId = await this.groups.studentIdForUser(manager, actor.id);
        if (state !== InvitacionEstado.CANCELADA && candidate.estudiante_destino_id !== actorStudentId) {
          throw new NotFoundException('No existe esa invitación en el período indicado.');
        }
        const lockedGroup = await manager.getRepository(Grupo).findOne({ where: { id: candidate.grupo.id, periodo: { id: periodoId } }, lock: { mode: 'pessimistic_write' } });
        if (!lockedGroup) throw new NotFoundException('No existe esa invitación en el período indicado.');
        const group = await manager.getRepository(Grupo).findOne({ where: { id: lockedGroup.id }, relations: { periodo: true } });
        if (!group) throw new NotFoundException('No existe esa invitación en el período indicado.');
        const schema = (manager.connection.options as PostgresConnectionOptions).schema ?? 'public';
        if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new ServiceUnavailableException('El esquema PostgreSQL configurado no es válido.');
        const lockedRows = await manager.query(`SELECT "id" FROM "${schema}"."invitacion" WHERE "id" = $1 AND "periodo_id" = $2 FOR UPDATE`, [id, periodoId]) as Array<{ id: string }>;
        if (!lockedRows[0]) throw new NotFoundException('No existe esa invitación en el período indicado.');
        const invitation = await inviteRepo.findOne({ where: { id, periodo: { id: periodoId } }, relations: { grupo: true } });
        if (!invitation) throw new NotFoundException('No existe esa invitación en el período indicado.');
        if (state === InvitacionEstado.CANCELADA) await this.groups.assertRepresentative(manager, group.id, actorStudentId);
        if (invitation.estado !== InvitacionEstado.PENDIENTE) throw new ConflictException('La invitación ya fue resuelta.');
        const now = new Date();
        if (invitation.expira_en.getTime() <= now.getTime()) {
          const oldState = invitation.estado;
          invitation.estado = InvitacionEstado.EXPIRADA;
          invitation.fecha_respuesta = invitation.expira_en;
          await inviteRepo.save(invitation);
          await this.auditoria.registrar(manager, { actor, accion: 'REGISTRAR_EXPIRACION_INVITACION', entidad_tipo: 'invitacion', entidad_id: invitation.id, valores_anteriores: { estado: oldState }, valores_nuevos: { estado: invitation.estado, fecha_respuesta: invitation.fecha_respuesta }, ip_origen: ip });
          await this.notificaciones.invitacion(manager, invitation.id, NotificacionTipo.INVITACION_EXPIRADA, actor.id);
          return { expired: true, id: invitation.id };
        }
        if (state === InvitacionEstado.ACEPTADA) {
          if (await this.postulaciones.grupoTienePostulaciones(manager, group.id)) throw new ConflictException('La composición del grupo está cerrada desde su primera postulación.');
          if (![GrupoEstado.EN_CONFORMACION, GrupoEstado.ACTIVO].includes(group.estado)) throw new ConflictException('El grupo no admite nuevas invitaciones.');
          const senderId = invitation.estudiante_emisor_id;
          await this.groups.assertRepresentative(manager, group.id, senderId);
          await this.groups.assertCurrentMembersEligible(manager, periodoId, group.id);
          await this.habilitados.getEligibleStudentForGroup(periodoId, actorStudentId, manager);
          if (await this.postulaciones.estudianteTienePostulacionIndividualActiva(manager, periodoId, actorStudentId)) throw new ConflictException('Cancela tu postulación individual antes de aceptar una invitación.');
          await this.groups.assertNoActiveMembership(manager, periodoId, actorStudentId);
          await this.groups.assertNeverMemberOfGroup(manager, group.id, actorStudentId);
          if (await this.groups.countActiveMembers(manager, group.id) >= period.max_integrantes_default) throw new ConflictException('El grupo ya alcanzó el máximo de integrantes del período.');
          this.groups.assertApplicationWindow(period);
          const resolvedAt = new Date();
          if (invitation.expira_en.getTime() <= resolvedAt.getTime()) {
            invitation.estado = InvitacionEstado.EXPIRADA;
            invitation.fecha_respuesta = invitation.expira_en;
            await inviteRepo.save(invitation);
            await this.auditoria.registrar(manager, { actor, accion: 'REGISTRAR_EXPIRACION_INVITACION', entidad_tipo: 'invitacion', entidad_id: invitation.id, valores_anteriores: { estado: InvitacionEstado.PENDIENTE }, valores_nuevos: { estado: InvitacionEstado.EXPIRADA, fecha_respuesta: invitation.expira_en }, ip_origen: ip });
            await this.notificaciones.invitacion(manager, invitation.id, NotificacionTipo.INVITACION_EXPIRADA, actor.id);
            return { expired: true, id: invitation.id };
          }
          const oldState = invitation.estado;
          invitation.estado = state;
          invitation.fecha_respuesta = resolvedAt;
          await inviteRepo.save(invitation);
          await this.groups.addInvitedMember(manager, group, actorStudentId, actor, ip);
          await this.auditoria.registrar(manager, { actor, accion: 'ACEPTAR_INVITACION_GRUPO', entidad_tipo: 'invitacion', entidad_id: invitation.id, valores_anteriores: { estado: oldState }, valores_nuevos: { estado: state, estudiante_destino_id: actorStudentId, fecha_respuesta: resolvedAt }, ip_origen: ip });
          await this.notificaciones.invitacion(manager, invitation.id, NotificacionTipo.INVITACION_ACEPTADA, actor.id);
          return { expired: false, id: invitation.id };
        }
        invitation.estado = state;
        invitation.fecha_respuesta = now;
        await inviteRepo.save(invitation);
        await this.auditoria.registrar(manager, { actor, accion: state === InvitacionEstado.RECHAZADA ? 'RECHAZAR_INVITACION_GRUPO' : 'CANCELAR_INVITACION_GRUPO', entidad_tipo: 'invitacion', entidad_id: invitation.id, valores_anteriores: { estado: InvitacionEstado.PENDIENTE }, valores_nuevos: { estado: state, fecha_respuesta: now }, ip_origen: ip });
        await this.notificaciones.invitacion(manager, invitation.id, state === InvitacionEstado.RECHAZADA ? NotificacionTipo.INVITACION_RECHAZADA : NotificacionTipo.INVITACION_CANCELADA, actor.id);
        return { expired: false, id: invitation.id };
      });
      if (outcome.expired) return { expired: true as const, item: null };
      return { expired: false as const, item: await this.getOne(periodoId, outcome.id) };
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  private async listBy(filter: { periodoId: string; grupoId?: string; destinoId?: string }, query: ListInvitacionesQueryDto): Promise<PagedInvitacionesResponseDto> {
    const now = new Date();
    const qb = this.invitations.createQueryBuilder('i').leftJoinAndSelect('i.periodo', 'p')
      .leftJoinAndSelect('i.grupo', 'g').leftJoinAndSelect('i.estudiante_emisor', 'sender')
      .leftJoinAndSelect('sender.usuario', 'senderUser').leftJoinAndSelect('i.estudiante_destino', 'target')
      .leftJoinAndSelect('target.usuario', 'targetUser').where('p.id = :periodoId', { periodoId: filter.periodoId });
    if (filter.grupoId) qb.andWhere('g.id = :grupoId', { grupoId: filter.grupoId });
    if (filter.destinoId) qb.andWhere('target.id = :destinoId', { destinoId: filter.destinoId });
    if (query.estado === InvitacionEstado.EXPIRADA) qb.andWhere('(i.estado = :expired OR (i.estado = :pending AND i.expira_en <= :now))', { expired: InvitacionEstado.EXPIRADA, pending: InvitacionEstado.PENDIENTE, now });
    else if (query.estado === InvitacionEstado.PENDIENTE) qb.andWhere('i.estado = :pending AND i.expira_en > :now', { pending: InvitacionEstado.PENDIENTE, now });
    else if (query.estado) qb.andWhere('i.estado = :state', { state: query.estado });
    const [items, total] = await qb.orderBy('i.fecha_envio', 'DESC').addOrderBy('i.id', 'ASC')
      .skip((query.page - 1) * query.limit).take(query.limit).getManyAndCount();
    return { data: items.map(response), total, page: query.page, limit: query.limit };
  }

  private async getOne(periodoId: string, id: string): Promise<InvitacionResponseDto> {
    const item = await this.invitations.findOne({ where: { id, periodo: { id: periodoId } }, relations });
    if (!item) throw new NotFoundException('No existe esa invitación en el período indicado.');
    return response(item);
  }

  private handleDatabaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (error instanceof QueryFailedError) {
      const code = (error.driverError as DriverError).code;
      if (code === '23505') throw new ConflictException('La pertenencia o invitación ya existe.');
      if (code === '23503' || code === '23514') throw new ConflictException('La operación no cumple las reglas de integridad del grupo.');
    }
    throw new ServiceUnavailableException('No fue posible completar la operación de invitaciones.');
  }
}
