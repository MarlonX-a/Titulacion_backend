import { ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { HabilitadosService } from '../habilitados/habilitados.service.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { CreateGrupoDto } from './dto/create-grupo.dto.js';
import { GrupoIntegranteResponseDto, GrupoPersonaDto, GrupoResponseDto, PagedGruposResponseDto } from './dto/grupo-response.dto.js';
import { ListGruposQueryDto } from './dto/list-grupos-query.dto.js';
import { GrupoIntegrante } from './entities/grupo-integrante.entity.js';
import { Grupo } from './entities/grupo.entity.js';
import { GrupoEstado } from './enums/grupo-estado.enum.js';
import { GrupoIntegranteEstado } from './enums/grupo-integrante-estado.enum.js';
import { GrupoIntegranteRol } from './enums/grupo-integrante-rol.enum.js';

interface DriverError { code?: string; }
const groupRelations = { periodo: true } as const;
const memberRelations = { estudiante: { usuario: true } } as const;
function person(member: GrupoIntegrante): GrupoPersonaDto {
  return { id: member.estudiante.id, nombres: member.estudiante.usuario.nombres, apellidos: member.estudiante.usuario.apellidos, matricula: member.estudiante.matricula };
}
function groupResponse(group: Grupo, members: GrupoIntegrante[]): GrupoResponseDto {
  const responseMembers: GrupoIntegranteResponseDto[] = members.map((item) => ({
    id: item.id, estudiante_id: item.estudiante.id, estudiante: person(item), rol_en_grupo: item.rol_en_grupo,
    estado: item.estado, fecha_ingreso: item.fecha_ingreso, fecha_salida: item.fecha_salida, motivo_salida: item.motivo_salida,
  }));
  const representative = members.find((item) => item.rol_en_grupo === GrupoIntegranteRol.REPRESENTANTE && item.estado === GrupoIntegranteEstado.ACTIVO);
  return { id: group.id, periodo_id: group.periodo.id, nombre: group.nombre, estado: group.estado, creado_en: group.creado_en,
    representante: representative ? person(representative) : null, integrantes: responseMembers };
}

@Injectable()
export class GruposService {
  constructor(
    @InjectRepository(Grupo) private readonly groups: Repository<Grupo>,
    @InjectRepository(GrupoIntegrante) private readonly members: Repository<GrupoIntegrante>,
    @InjectRepository(Estudiante) private readonly students: Repository<Estudiante>,
    private readonly dataSource: DataSource,
    private readonly habilitados: HabilitadosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async create(periodoId: string, actor: Usuario, dto: CreateGrupoDto, ip: string | null): Promise<GrupoResponseDto> {
    try {
      const id = await this.dataSource.transaction(async (manager) => {
        const period = await this.lockOpenPeriod(manager, periodoId);
        if (period.max_integrantes_default < 2) throw new ConflictException('Este período no permite conformar grupos porque el máximo de integrantes es menor que dos.');
        const studentId = await this.studentIdForUser(manager, actor.id);
        await this.habilitados.getEligibleStudentForGroup(periodoId, studentId, manager);
        await this.assertNoActiveMembership(manager, periodoId, studentId);
        const groupRepo = manager.getRepository(Grupo);
        const group = await groupRepo.save(groupRepo.create({ periodo: period, nombre: dto.nombre.trim(), estado: GrupoEstado.EN_CONFORMACION }));
        const memberRepo = manager.getRepository(GrupoIntegrante);
        const member = await memberRepo.save(memberRepo.create({ grupo: group, periodo: period, estudiante: { id: studentId } as Estudiante, rol_en_grupo: GrupoIntegranteRol.REPRESENTANTE, estado: GrupoIntegranteEstado.ACTIVO, fecha_ingreso: new Date(), fecha_salida: null, motivo_salida: null }));
        await this.auditoria.registrar(manager, { actor, accion: 'CREAR_GRUPO', entidad_tipo: 'grupo', entidad_id: group.id, valores_anteriores: null, valores_nuevos: { periodo_id: periodoId, nombre: group.nombre, estado: group.estado, representante_id: studentId }, ip_origen: ip });
        await this.auditoria.registrar(manager, { actor, accion: 'INCORPORAR_INTEGRANTE_GRUPO', entidad_tipo: 'grupo_integrante', entidad_id: member.id, valores_anteriores: null, valores_nuevos: { grupo_id: group.id, periodo_id: periodoId, estudiante_id: studentId, rol_en_grupo: member.rol_en_grupo, estado: member.estado }, ip_origen: ip });
        return group.id;
      });
      return this.getRecord(periodoId, id);
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async list(periodoId: string, query: ListGruposQueryDto): Promise<PagedGruposResponseDto> {
    try {
      const period = await this.dataSource.getRepository(PeriodoTitulacion).findOne({ where: { id: periodoId } });
      if (!period) throw new NotFoundException('No existe el período indicado.');
      const qb = this.groups.createQueryBuilder('g').leftJoinAndSelect('g.periodo', 'p')
        .where('p.id = :periodoId', { periodoId });
      if (query.estado) qb.andWhere('g.estado = :estado', { estado: query.estado });
      const [groups, total] = await qb.orderBy('g.creado_en', 'DESC').addOrderBy('g.id', 'ASC')
        .skip((query.page - 1) * query.limit).take(query.limit).getManyAndCount();
      const data = await Promise.all(groups.map(async (group) => this.getRecord(periodoId, group.id)));
      return { data, total, page: query.page, limit: query.limit };
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async getMine(periodoId: string, actor: Usuario): Promise<GrupoResponseDto> {
    try {
      const student = await this.students.findOne({ where: { usuario: { id: actor.id } } });
      if (!student) throw new NotFoundException('No tienes perfil de estudiante.');
      const membership = await this.members.findOne({ where: { periodo: { id: periodoId }, estudiante: { id: student.id }, estado: GrupoIntegranteEstado.ACTIVO }, relations: { grupo: true } });
      if (!membership) throw new NotFoundException('No perteneces a un grupo activo en este período.');
      return await this.getRecord(periodoId, membership.grupo.id);
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async getById(periodoId: string, id: string, actor: Usuario, isAdmin: boolean): Promise<GrupoResponseDto> {
    try {
      const group = await this.groups.findOne({ where: { id, periodo: { id: periodoId } }, relations: groupRelations });
      if (!group) throw new NotFoundException('No existe ese grupo en el período indicado.');
      if (!isAdmin) {
        const student = await this.students.findOne({ where: { usuario: { id: actor.id } } });
        const member = student ? await this.members.findOne({ where: { grupo: { id }, estudiante: { id: student.id }, estado: GrupoIntegranteEstado.ACTIVO } }) : null;
        if (!member) throw new NotFoundException('No existe ese grupo en el período indicado.');
      }
      return this.getRecord(periodoId, id);
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  /** Internal API for invitations; period lock is always acquired before group/member locks. */
  async lockOpenPeriod(manager: EntityManager, periodoId: string): Promise<PeriodoTitulacion> {
    const period = await this.lockPeriod(manager, periodoId);
    this.assertApplicationWindow(period);
    return period;
  }

  async lockPeriod(manager: EntityManager, periodoId: string): Promise<PeriodoTitulacion> {
    const period = await manager.getRepository(PeriodoTitulacion).findOne({ where: { id: periodoId }, lock: { mode: 'pessimistic_write' } });
    if (!period) throw new NotFoundException('No existe el período indicado.');
    return period;
  }

  assertApplicationWindow(period: PeriodoTitulacion): void {
    const now = Date.now();
    if (period.estado !== PeriodoEstado.POSTULACION_ABIERTA || now < period.fecha_inicio_postulacion.getTime() || now >= period.fecha_fin_postulacion.getTime()) {
      throw new ConflictException('El período no está dentro del plazo abierto de postulación.');
    }
  }

  async lockGroup(manager: EntityManager, periodoId: string, groupId: string): Promise<Grupo> {
    const group = await manager.getRepository(Grupo).findOne({ where: { id: groupId, periodo: { id: periodoId } }, relations: groupRelations, lock: { mode: 'pessimistic_write' } });
    if (!group) throw new NotFoundException('No existe ese grupo en el período indicado.');
    if (![GrupoEstado.EN_CONFORMACION, GrupoEstado.ACTIVO].includes(group.estado)) throw new ConflictException('El grupo no admite nuevas invitaciones.');
    return group;
  }

  async studentIdForUser(manager: EntityManager, usuarioId: string): Promise<string> {
    const student = await manager.getRepository(Estudiante).findOne({ where: { usuario: { id: usuarioId } } });
    if (!student) throw new NotFoundException('No tienes perfil de estudiante.');
    return student.id;
  }

  async assertNoActiveMembership(manager: EntityManager, periodoId: string, studentId: string): Promise<void> {
    const existing = await manager.getRepository(GrupoIntegrante).findOne({ where: { periodo: { id: periodoId }, estudiante: { id: studentId }, estado: GrupoIntegranteEstado.ACTIVO } });
    if (existing) throw new ConflictException('El estudiante ya pertenece a un grupo activo en este período.');
  }

  async assertRepresentative(manager: EntityManager, groupId: string, studentId: string): Promise<void> {
    const member = await manager.getRepository(GrupoIntegrante).findOne({ where: { grupo: { id: groupId }, estudiante: { id: studentId }, estado: GrupoIntegranteEstado.ACTIVO, rol_en_grupo: GrupoIntegranteRol.REPRESENTANTE } });
    if (!member) throw new ForbiddenException('Solo el representante activo del grupo puede realizar esta operación.');
  }

  async assertCurrentMembersEligible(manager: EntityManager, periodoId: string, groupId: string): Promise<void> {
    const members = await manager.getRepository(GrupoIntegrante).find({ where: { grupo: { id: groupId }, periodo: { id: periodoId }, estado: GrupoIntegranteEstado.ACTIVO }, relations: { estudiante: true }, order: { estudiante: { id: 'ASC' } } });
    for (const member of members) await this.habilitados.getEligibleStudentForGroup(periodoId, member.estudiante.id, manager);
  }

  async countActiveMembers(manager: EntityManager, groupId: string): Promise<number> {
    return manager.getRepository(GrupoIntegrante).count({ where: { grupo: { id: groupId }, estado: GrupoIntegranteEstado.ACTIVO } });
  }

  async addInvitedMember(manager: EntityManager, group: Grupo, studentId: string, actor: Usuario, ip: string | null): Promise<void> {
    const repo = manager.getRepository(GrupoIntegrante);
    const member = await repo.save(repo.create({ grupo: group, periodo: group.periodo, estudiante: { id: studentId } as Estudiante, rol_en_grupo: GrupoIntegranteRol.INTEGRANTE, estado: GrupoIntegranteEstado.ACTIVO, fecha_ingreso: new Date(), fecha_salida: null, motivo_salida: null }));
    const count = await this.countActiveMembers(manager, group.id);
    const updatedState = count >= 2 ? GrupoEstado.ACTIVO : group.estado;
    if (updatedState !== group.estado) {
      const previous = group.estado;
      group.estado = updatedState;
      await manager.getRepository(Grupo).save(group);
      await this.auditoria.registrar(manager, { actor, accion: 'ACTIVAR_GRUPO', entidad_tipo: 'grupo', entidad_id: group.id, valores_anteriores: { estado: previous }, valores_nuevos: { estado: updatedState }, ip_origen: ip });
    }
    await this.auditoria.registrar(manager, { actor, accion: 'INCORPORAR_INTEGRANTE_GRUPO', entidad_tipo: 'grupo_integrante', entidad_id: member.id, valores_anteriores: null, valores_nuevos: { grupo_id: group.id, periodo_id: group.periodo.id, estudiante_id: studentId, rol_en_grupo: member.rol_en_grupo, estado: member.estado }, ip_origen: ip });
  }

  async hasStudentMembership(periodoId: string, actor: Usuario, groupId: string): Promise<boolean> {
    const student = await this.students.findOne({ where: { usuario: { id: actor.id } } });
    return !!student && !!(await this.members.findOne({ where: { periodo: { id: periodoId }, grupo: { id: groupId }, estudiante: { id: student.id }, estado: GrupoIntegranteEstado.ACTIVO } }));
  }

  private async getRecord(periodoId: string, id: string): Promise<GrupoResponseDto> {
    const group = await this.groups.findOne({ where: { id, periodo: { id: periodoId } }, relations: groupRelations });
    if (!group) throw new NotFoundException('No existe ese grupo en el período indicado.');
    const members = await this.members.find({ where: { grupo: { id }, periodo: { id: periodoId } }, relations: memberRelations, order: { fecha_ingreso: 'ASC', id: 'ASC' } });
    return groupResponse(group, members);
  }

  private handleDatabaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (error instanceof QueryFailedError) {
      const code = (error.driverError as DriverError).code;
      if (code === '23505') throw new ConflictException('El estudiante ya pertenece a un grupo activo o se produjo un conflicto de pertenencia.');
      if (code === '23503' || code === '23514') throw new ConflictException('La operación no cumple las reglas de integridad del grupo.');
    }
    throw new ServiceUnavailableException('No fue posible completar la operación de grupos.');
  }
}
