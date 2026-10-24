import { ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { HabilitadosService } from '../habilitados/habilitados.service.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { InvitacionPersistenciaService } from '../invitaciones/invitacion-persistencia.service.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { CambiarRepresentanteDto } from './dto/cambiar-representante.dto.js';
import { GrupoResponseDto } from './dto/grupo-response.dto.js';
import { RetirarIntegranteDto } from './dto/retirar-integrante.dto.js';
import { MotivoGrupoDto } from './dto/motivo-grupo.dto.js';
import { GrupoIntegrante } from './entities/grupo-integrante.entity.js';
import { Grupo } from './entities/grupo.entity.js';
import { GrupoEstado } from './enums/grupo-estado.enum.js';
import { GrupoIntegranteEstado } from './enums/grupo-integrante-estado.enum.js';
import { GrupoIntegranteRol } from './enums/grupo-integrante-rol.enum.js';
import { GruposService } from './grupos.service.js';
import { PostulacionPersistenciaService } from '../postulaciones/postulacion-persistencia.service.js';

interface DriverError { code?: string; }

@Injectable()
export class GrupoGestionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly grupos: GruposService,
    private readonly habilitados: HabilitadosService,
    private readonly auditoria: AuditoriaService,
    private readonly invitaciones: InvitacionPersistenciaService,
    private readonly postulaciones: PostulacionPersistenciaService,
  ) {}

  async salir(periodoId: string, grupoId: string, actor: Usuario, dto: MotivoGrupoDto, ip: string | null): Promise<GrupoResponseDto> {
    try {
      await this.dataSource.transaction(async (manager) => {
        const period = await this.lockPeriod(manager, periodoId, false);
        const group = await this.grupos.lockGroup(manager, periodoId, grupoId);
        await this.assertCompositionOpen(manager, group.id);
        const studentId = await this.grupos.studentIdForUser(manager, actor.id);
        const members = await this.lockActiveMembers(manager, group.id);
        const member = members.find((item) => item.estudiante.id === studentId);
        if (!member) throw new NotFoundException('No perteneces activamente a ese grupo.');
        if (member.rol_en_grupo === GrupoIntegranteRol.REPRESENTANTE && members.length > 1) {
          throw new ConflictException('Transfiere la representación antes de salir del grupo.');
        }
        const now = new Date();
        this.assertPeriodWindow(period, false, now);
        await this.retireMember(manager, member, dto.motivo, now);
        const nextState = members.length === 1 ? GrupoEstado.DISUELTO : members.length === 2 ? GrupoEstado.EN_CONFORMACION : group.estado;
        await this.updateGroupState(manager, group, nextState, actor, ip, 'SALIR_GRUPO', dto.motivo);
        await this.auditMember(manager, actor, 'SALIR_GRUPO', member, GrupoIntegranteEstado.ACTIVO, ip, dto.motivo);
        if (nextState === GrupoEstado.DISUELTO) await this.invitaciones.resolverPendientesDelGrupo(manager, group.id, actor, dto.motivo, ip, 'DISOLVER_GRUPO');
      });
      return this.grupos.getById(periodoId, grupoId, actor, true);
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async cambiarRepresentante(periodoId: string, grupoId: string, actor: Usuario, isAdmin: boolean, dto: CambiarRepresentanteDto, ip: string | null): Promise<GrupoResponseDto> {
    try {
      await this.dataSource.transaction(async (manager) => {
        const period = await this.lockPeriod(manager, periodoId, isAdmin);
        const group = await this.grupos.lockGroup(manager, periodoId, grupoId);
        const actorStudentId = isAdmin ? null : await this.grupos.studentIdForUser(manager, actor.id);
        const members = await this.lockActiveMembers(manager, group.id);
        const current = members.find((item) => item.rol_en_grupo === GrupoIntegranteRol.REPRESENTANTE);
        if (!current) throw new ConflictException('El grupo no tiene un representante activo que pueda transferir el cargo.');
        if (!isAdmin && current.estudiante.id !== actorStudentId) throw new ForbiddenException('Solo el representante activo puede transferir el cargo.');
        const target = members.find((item) => item.estudiante.id === dto.estudiante_id);
        if (!target) throw new ConflictException('El nuevo representante debe ser integrante activo del grupo.');
        if (target.id === current.id) throw new ConflictException('El estudiante indicado ya es representante.');
        await this.habilitados.getEligibleStudentForGroup(periodoId, target.estudiante.id, manager);
        const now = new Date();
        this.assertPeriodWindow(period, isAdmin, now);
        const before = { representante_id: current.estudiante.id, grupo_estado: group.estado };
        current.rol_en_grupo = GrupoIntegranteRol.INTEGRANTE;
        target.rol_en_grupo = GrupoIntegranteRol.REPRESENTANTE;
        const repo = manager.getRepository(GrupoIntegrante);
        await repo.save(current);
        await repo.save(target);
        await this.invitaciones.resolverPendientesDelGrupo(manager, group.id, actor, dto.motivo, ip, 'CAMBIAR_REPRESENTANTE');
        await this.auditoria.registrar(manager, { actor, accion: 'CAMBIAR_REPRESENTANTE', entidad_tipo: 'grupo', entidad_id: group.id, valores_anteriores: before, valores_nuevos: { representante_id: target.estudiante.id, grupo_estado: group.estado, motivo: dto.motivo }, ip_origen: ip });
      });
      return this.grupos.getById(periodoId, grupoId, actor, true);
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async retirarIntegrante(periodoId: string, grupoId: string, estudianteId: string, actor: Usuario, dto: RetirarIntegranteDto, ip: string | null): Promise<GrupoResponseDto> {
    try {
      await this.dataSource.transaction(async (manager) => {
        const period = await this.lockPeriod(manager, periodoId, true);
        const group = await this.grupos.lockGroup(manager, periodoId, grupoId);
        const members = await this.lockActiveMembers(manager, group.id);
        const target = members.find((item) => item.estudiante.id === estudianteId);
        if (!target) throw new ConflictException('El estudiante no es integrante activo del grupo.');
        const wasRepresentative = target.rol_en_grupo === GrupoIntegranteRol.REPRESENTANTE;
        await this.assertCompositionOpen(manager, group.id);
        const replacementId = dto.nuevo_representante_id;
        if (wasRepresentative && members.length > 1 && !replacementId) throw new ConflictException('Debes designar un nuevo representante al retirar al representante actual.');
        if (!wasRepresentative && replacementId) throw new ConflictException('Solo puedes designar reemplazo al retirar al representante.');
        let replacement: GrupoIntegrante | undefined;
        if (replacementId) {
          replacement = members.find((item) => item.estudiante.id === replacementId);
          if (!replacement || replacement.id === target.id) throw new ConflictException('El reemplazo debe ser otro integrante activo del grupo.');
          await this.habilitados.getEligibleStudentForGroup(periodoId, replacement.estudiante.id, manager);
        }
        const now = new Date();
        this.assertPeriodWindow(period, true, now);
        const previousRole = target.rol_en_grupo;
        if (replacement && wasRepresentative) {
          target.rol_en_grupo = GrupoIntegranteRol.INTEGRANTE;
          replacement.rol_en_grupo = GrupoIntegranteRol.REPRESENTANTE;
          const repo = manager.getRepository(GrupoIntegrante);
          await repo.save(target);
          await repo.save(replacement);
          await this.invitaciones.resolverPendientesDelGrupo(manager, group.id, actor, dto.motivo, ip, 'CAMBIAR_REPRESENTANTE');
          await this.auditoria.registrar(manager, { actor, accion: 'CAMBIAR_REPRESENTANTE', entidad_tipo: 'grupo', entidad_id: group.id, valores_anteriores: { representante_id: target.estudiante.id }, valores_nuevos: { representante_id: replacement.estudiante.id, motivo: dto.motivo.trim() }, ip_origen: ip });
        }
        await this.retireMember(manager, target, dto.motivo, now);
        const remaining = members.length - 1;
        const nextState = remaining === 0 ? GrupoEstado.DISUELTO : remaining === 1 ? GrupoEstado.EN_CONFORMACION : group.estado;
        await this.updateGroupState(manager, group, nextState, actor, ip, 'RETIRAR_INTEGRANTE_GRUPO', dto.motivo);
        await this.auditMember(manager, actor, 'RETIRAR_INTEGRANTE_GRUPO', target, GrupoIntegranteEstado.ACTIVO, ip, dto.motivo, previousRole);
        if (nextState === GrupoEstado.DISUELTO) await this.invitaciones.resolverPendientesDelGrupo(manager, group.id, actor, dto.motivo, ip, 'DISOLVER_GRUPO');
      });
      return this.grupos.getById(periodoId, grupoId, actor, true);
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async disolver(periodoId: string, grupoId: string, actor: Usuario, isAdmin: boolean, dto: MotivoGrupoDto, ip: string | null): Promise<GrupoResponseDto> {
    try {
      await this.dataSource.transaction(async (manager) => {
        const period = await this.lockPeriod(manager, periodoId, isAdmin);
        const group = await this.grupos.lockGroup(manager, periodoId, grupoId);
        await this.assertCompositionOpen(manager, group.id);
        const members = await this.lockActiveMembers(manager, group.id);
        if (members.length === 0) throw new ConflictException('El grupo no tiene integrantes activos.');
        if (!isAdmin) {
          const studentId = await this.grupos.studentIdForUser(manager, actor.id);
          if (members.find((item) => item.estudiante.id === studentId)?.rol_en_grupo !== GrupoIntegranteRol.REPRESENTANTE) {
            throw new ForbiddenException('Solo el representante activo puede disolver el grupo.');
          }
        }
        const now = new Date();
        this.assertPeriodWindow(period, isAdmin, now);
        for (const member of members) {
          await this.retireMember(manager, member, dto.motivo, now);
          await this.auditMember(manager, actor, 'DISOLVER_GRUPO', member, GrupoIntegranteEstado.ACTIVO, ip, dto.motivo);
        }
        await this.invitaciones.resolverPendientesDelGrupo(manager, group.id, actor, dto.motivo, ip, 'DISOLVER_GRUPO');
        await this.updateGroupState(manager, group, GrupoEstado.DISUELTO, actor, ip, 'DISOLVER_GRUPO', dto.motivo);
      });
      return this.grupos.getById(periodoId, grupoId, actor, true);
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  private async lockPeriod(manager: EntityManager, periodoId: string, admin: boolean): Promise<PeriodoTitulacion> {
    const period = await this.grupos.lockPeriod(manager, periodoId);
    this.assertPeriodWindow(period, admin, new Date());
    return period;
  }

  private async assertCompositionOpen(manager: EntityManager, groupId: string): Promise<void> {
    if (await this.postulaciones.grupoTienePostulaciones(manager, groupId)) throw new ConflictException('La composición del grupo está cerrada desde su primera postulación.');
  }

  private assertPeriodWindow(period: PeriodoTitulacion, admin: boolean, now: Date): void {
    if (admin) {
      if (![PeriodoEstado.POSTULACION_ABIERTA, PeriodoEstado.POSTULACION_CERRADA].includes(period.estado) || now.getTime() >= period.fecha_inicio_titulacion.getTime()) {
        throw new ConflictException('ADMIN solo puede reorganizar grupos antes del inicio de titulación y con postulación abierta o cerrada.');
      }
      return;
    }
    if (period.estado !== PeriodoEstado.POSTULACION_ABIERTA || now.getTime() < period.fecha_inicio_postulacion.getTime() || now.getTime() >= period.fecha_fin_postulacion.getTime()) {
      throw new ConflictException('La acción del estudiante solo está disponible durante el plazo de postulación.');
    }
  }

  private lockActiveMembers(manager: EntityManager, groupId: string): Promise<GrupoIntegrante[]> {
    return manager.getRepository(GrupoIntegrante).createQueryBuilder('m').innerJoinAndSelect('m.estudiante', 'e')
      .where('m.grupo_id = :groupId AND m.estado = :state', { groupId, state: GrupoIntegranteEstado.ACTIVO })
      .orderBy('m.estudiante_id', 'ASC').addOrderBy('m.id', 'ASC').setLock('pessimistic_write').getMany();
  }

  private async retireMember(manager: EntityManager, member: GrupoIntegrante, reason: string, at: Date): Promise<void> {
    member.estado = GrupoIntegranteEstado.RETIRADO;
    member.fecha_salida = at;
    member.motivo_salida = reason.trim();
    await manager.getRepository(GrupoIntegrante).save(member);
  }

  private async updateGroupState(manager: EntityManager, group: Grupo, state: GrupoEstado, actor: Usuario, ip: string | null, action: string, reason: string): Promise<void> {
    if (group.estado === state) return;
    const previous = group.estado;
    group.estado = state;
    await manager.getRepository(Grupo).save(group);
    await this.auditoria.registrar(manager, { actor, accion: action, entidad_tipo: 'grupo', entidad_id: group.id, valores_anteriores: { estado: previous }, valores_nuevos: { estado: state, motivo: reason.trim() }, ip_origen: ip });
  }

  private async auditMember(manager: EntityManager, actor: Usuario, action: string, member: GrupoIntegrante, previousState: GrupoIntegranteEstado, ip: string | null, reason: string, previousRole: GrupoIntegranteRol = member.rol_en_grupo): Promise<void> {
    await this.auditoria.registrar(manager, { actor, accion: action, entidad_tipo: 'grupo_integrante', entidad_id: member.id, valores_anteriores: { estado: previousState, rol_en_grupo: previousRole }, valores_nuevos: { estado: member.estado, rol_en_grupo: member.rol_en_grupo, fecha_salida: member.fecha_salida, motivo_salida: member.motivo_salida ?? reason.trim() }, ip_origen: ip });
  }

  private handleDatabaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (error instanceof QueryFailedError) {
      const code = (error.driverError as DriverError).code;
      if (code === '23505') throw new ConflictException('La operación entra en conflicto con una pertenencia o representación existente.');
      if (code === '23503' || code === '23514') throw new ConflictException('La operación no cumple las reglas de integridad del grupo.');
    }
    throw new ServiceUnavailableException('No fue posible completar la operación de grupos.');
  }
}
