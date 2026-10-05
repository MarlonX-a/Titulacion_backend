import { ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { EstudianteHabilitado } from '../habilitados/entities/estudiante-habilitado.entity.js';
import { HabilitadosService } from '../habilitados/habilitados.service.js';
import { Grupo } from '../grupos/entities/grupo.entity.js';
import { GrupoIntegrante } from '../grupos/entities/grupo-integrante.entity.js';
import { GrupoEstado } from '../grupos/enums/grupo-estado.enum.js';
import { GrupoIntegranteEstado } from '../grupos/enums/grupo-integrante-estado.enum.js';
import { GrupoIntegranteRol } from '../grupos/enums/grupo-integrante-rol.enum.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { Tema } from '../temas/entities/tema.entity.js';
import { EstadoTema } from '../temas/enums/estado-tema.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { Postulacion } from './entities/postulacion.entity.js';
import { InvitacionPersistenciaService } from '../invitaciones/invitacion-persistencia.service.js';
import { EstadoPostulacion } from './enums/estado-postulacion.enum.js';
import { ModalidadPostulacion } from './enums/modalidad-postulacion.enum.js';
import { CreatePostulacionDto } from './dto/create-postulacion.dto.js';
import { CancelarPostulacionDto } from './dto/cancelar-postulacion.dto.js';
import { ListPostulacionesQueryDto } from './dto/list-postulaciones-query.dto.js';
import { PagedPostulacionesResponseDto, PostulacionResponseDto } from './dto/postulacion-response.dto.js';
import { TutoresPropuestosService } from './tutores-propuestos.service.js';

interface DriverError { code?: string; }
const relations = { periodo: true, tema: { linea: true, docente_proponente: { usuario: true } }, grupo: true, estudiante: { usuario: true }, registrada_por: true } as const;

@Injectable()
export class PostulacionesService {
  constructor(
    @InjectRepository(Postulacion) private readonly repository: Repository<Postulacion>,
    @InjectRepository(Estudiante) private readonly students: Repository<Estudiante>,
    @InjectRepository(GrupoIntegrante) private readonly members: Repository<GrupoIntegrante>,
    private readonly dataSource: DataSource,
    private readonly habilitados: HabilitadosService,
    private readonly auditoria: AuditoriaService,
    private readonly invitaciones: InvitacionPersistenciaService,
    private readonly tutores: TutoresPropuestosService,
  ) {}

  async create(periodoId: string, actor: Usuario, dto: CreatePostulacionDto, ip: string | null): Promise<PostulacionResponseDto> {
    try {
      const id = await this.dataSource.transaction(async (manager) => {
        const period = await this.lockPeriod(manager, periodoId);
        this.assertStudentWindow(period);
        const topic = await manager.getRepository(Tema).findOne({ where: { id: dto.tema_id, periodo: { id: periodoId } }, lock: { mode: 'pessimistic_write' } });
        if (!topic) throw new NotFoundException('No existe ese tema en el período indicado.');
        if (topic.estado !== EstadoTema.PUBLICADO) throw new ConflictException('Solo se puede postular a temas publicados.');
        let studentId: string | null = null;
        let groupId: string | null = null;
        let participantIds: string[];
        let count: number;
        if (dto.modalidad === ModalidadPostulacion.INDIVIDUAL) {
          studentId = await this.studentId(manager, actor.id);
          await this.habilitados.getEligibleStudentForGroup(periodoId, studentId, manager);
          if (await manager.getRepository(GrupoIntegrante).findOne({ where: { periodo: { id: periodoId }, estudiante: { id: studentId }, estado: GrupoIntegranteEstado.ACTIVO } })) throw new ConflictException('Para postular individualmente debes estar fuera de los grupos del período.');
          participantIds = [studentId]; count = 1;
        } else {
          const student = await this.studentId(manager, actor.id);
          const representative = await manager.getRepository(GrupoIntegrante).findOne({ where: { periodo: { id: periodoId }, estudiante: { id: student }, estado: GrupoIntegranteEstado.ACTIVO, rol_en_grupo: GrupoIntegranteRol.REPRESENTANTE }, relations: { grupo: true } });
          if (!representative) throw new ForbiddenException('Solo el representante de un grupo activo puede registrar la postulación grupal.');
          const group = await manager.getRepository(Grupo).findOne({ where: { id: representative.grupo.id }, lock: { mode: 'pessimistic_write' } });
          if (!group || group.estado !== GrupoEstado.ACTIVO) throw new ConflictException('La postulación grupal requiere un grupo ACTIVO.');
          groupId = group.id;
          const members = await manager.getRepository(GrupoIntegrante).find({ where: { grupo: { id: group.id }, estado: GrupoIntegranteEstado.ACTIVO }, relations: { estudiante: true }, order: { estudiante: { id: 'ASC' } } });
          participantIds = members.map((member) => member.estudiante.id); count = participantIds.length;
          if (count < 2) throw new ConflictException('La postulación grupal requiere al menos dos integrantes activos.');
          if (!participantIds.includes(student)) throw new ForbiddenException('No formas parte del grupo representante.');
          for (const participantId of participantIds) await this.habilitados.getEligibleStudentForGroup(periodoId, participantId, manager);
        }
        if (count < topic.min_integrantes || count > topic.max_integrantes) throw new ConflictException(`El tema admite entre ${topic.min_integrantes} y ${topic.max_integrantes} integrantes; la solicitud tiene ${count}.`);
        this.assertStudentWindow(period);
        const repo = manager.getRepository(Postulacion);
        if (groupId && !(await manager.getRepository(Postulacion).findOne({ where: { grupo: { id: groupId } } }))) {
          await this.invitaciones.resolverPendientesDelGrupo(manager, groupId, actor, 'Composición cerrada por primera postulación grupal', ip, 'POSTULAR_GRUPO');
        }
        const item = await repo.save(repo.create({ tema: topic, periodo: period, grupo: groupId ? { id: groupId } as Grupo : null, estudiante: studentId ? { id: studentId } as Estudiante : null, num_integrantes: count, registrada_por: actor, estado: EstadoPostulacion.PENDIENTE, fecha_postulacion: new Date(), observacion: null }));
        await this.tutores.agregar(manager, item.id, dto.tutores_propuestos);
        await this.auditoria.registrar(manager, { actor, accion: 'CREAR_POSTULACION', entidad_tipo: 'postulacion', entidad_id: item.id, valores_anteriores: null, valores_nuevos: { tema_id: topic.id, periodo_id: period.id, grupo_id: groupId, estudiante_id: studentId, participantes: participantIds, num_integrantes: count, estado: item.estado, fecha_postulacion: item.fecha_postulacion, tutores_propuestos: dto.tutores_propuestos.map((docente_id, index) => ({ docente_id, orden_prioridad: index + 1 })) }, ip_origen: ip });
        await this.auditoria.registrar(manager, { actor, accion: 'REGISTRAR_TUTORES_PROPUESTOS', entidad_tipo: 'postulacion', entidad_id: item.id, valores_anteriores: null, valores_nuevos: { tutores_propuestos: dto.tutores_propuestos.map((docente_id, index) => ({ docente_id, orden_prioridad: index + 1 })) }, ip_origen: ip });
        return item.id;
      });
      return this.getRecord(periodoId, id);
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async completarTutores(periodoId: string, id: string, actor: Usuario, docenteIds: string[], ip: string | null): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        const period = await this.lockPeriod(manager, periodoId);
        this.assertStudentWindow(period);
        const initial = await manager.getRepository(Postulacion).findOne({ where: { id, periodo: { id: periodoId } }, relations: { tema: true, grupo: true, estudiante: true } });
        if (!initial) throw new NotFoundException('No existe esa postulación en el período indicado.');
        const topic = await manager.getRepository(Tema).findOne({ where: { id: initial.tema.id, periodo: { id: periodoId } }, lock: { mode: 'pessimistic_write' } });
        if (!topic) throw new NotFoundException('No existe el tema de esa postulación.');
        if (initial.grupo) {
          const group = await manager.getRepository(Grupo).findOne({ where: { id: initial.grupo.id }, lock: { mode: 'pessimistic_write' } });
          if (!group) throw new NotFoundException('No existe el grupo de esa postulación.');
        }
        const schema = this.schemaName(manager);
        const locked = await manager.query(`SELECT "id" FROM ${schema}."postulacion" WHERE "id"=$1 AND "periodo_id"=$2 FOR UPDATE`, [id, periodoId]) as Array<{ id: string }>;
        if (!locked[0]) throw new NotFoundException('No existe esa postulación en el período indicado.');
        const repo = manager.getRepository(Postulacion);
        const item = await repo.findOne({ where: { id }, relations: { tema: true, grupo: true, estudiante: true } });
        if (!item) throw new NotFoundException('No existe esa postulación en el período indicado.');
        if (item.estado !== EstadoPostulacion.PENDIENTE) throw new ConflictException('Solo se pueden completar postulaciones PENDIENTE.');
        const existing = await manager.query(`SELECT 1 FROM ${schema}."tutor_propuesto" WHERE "postulacion_id"=$1 LIMIT 1`, [id]) as unknown[];
        if (existing.length) throw new ConflictException('Esta postulación ya tiene una lista de tutores y no puede modificarse.');
        if (topic.estado !== EstadoTema.PUBLICADO) throw new ConflictException('El tema ya no está publicado.');
        if (item.grupo) {
          const representative = await manager.getRepository(GrupoIntegrante).findOne({ where: { grupo: { id: item.grupo.id }, estudiante: { usuario: { id: actor.id } }, estado: GrupoIntegranteEstado.ACTIVO, rol_en_grupo: GrupoIntegranteRol.REPRESENTANTE } });
          if (!representative) throw new NotFoundException('No existe esa postulación visible para el usuario.');
          const participants = await manager.getRepository(GrupoIntegrante).find({ where: { grupo: { id: item.grupo.id }, estado: GrupoIntegranteEstado.ACTIVO }, order: { estudiante: { id: 'ASC' } } });
          for (const participant of participants) await this.habilitados.getEligibleStudentForGroup(periodoId, participant.estudiante.id, manager);
          if (participants.length !== item.num_integrantes || participants.length < topic.min_integrantes || participants.length > topic.max_integrantes) throw new ConflictException('La composición o el rango del tema ya no es compatible.');
        } else {
          const studentId = await this.studentId(manager, actor.id);
          if (item.estudiante?.id !== studentId) throw new NotFoundException('No existe esa postulación visible para el usuario.');
          await this.habilitados.getEligibleStudentForGroup(periodoId, studentId, manager);
          if (topic.min_integrantes > 1 || topic.max_integrantes < 1) throw new ConflictException('El tema no admite una postulación individual.');
        }
        this.assertStudentWindow(period);
        await this.tutores.agregar(manager, id, docenteIds);
        await this.auditoria.registrar(manager, { actor, accion: 'REGISTRAR_TUTORES_PROPUESTOS', entidad_tipo: 'postulacion', entidad_id: id, valores_anteriores: null, valores_nuevos: { tutores_propuestos: docenteIds.map((docente_id, index) => ({ docente_id, orden_prioridad: index + 1 })) }, ip_origen: ip });
      });
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async cancel(periodoId: string, id: string, actor: Usuario, isAdmin: boolean, dto: CancelarPostulacionDto, ip: string | null): Promise<PostulacionResponseDto> {
    try {
      await this.dataSource.transaction(async (manager) => {
        const period = await this.lockPeriod(manager, periodoId);
        const repo = manager.getRepository(Postulacion);
        const schema = this.schemaName(manager);
        const locked = await manager.query(`SELECT "id" FROM ${schema}."postulacion" WHERE "id"=$1 AND "periodo_id"=$2 FOR UPDATE`, [id, periodoId]) as Array<{ id: string }>;
        if (!locked[0]) throw new NotFoundException('No existe esa postulación en el período indicado.');
        const item = await repo.findOne({ where: { id, periodo: { id: periodoId } }, relations: { tema: true, grupo: true, estudiante: true } });
        if (!item) throw new NotFoundException('No existe esa postulación en el período indicado.');
        if (item.estado !== EstadoPostulacion.PENDIENTE) throw new ConflictException('Solo se pueden cancelar postulaciones PENDIENTE.');
        if (isAdmin) {
          const now = Date.now();
          if (![PeriodoEstado.POSTULACION_ABIERTA, PeriodoEstado.POSTULACION_CERRADA].includes(period.estado) || now >= period.fecha_inicio_titulacion.getTime()) throw new ConflictException('ADMIN solo puede cancelar antes del inicio de titulación.');
        } else {
          this.assertStudentWindow(period);
          const studentId = await this.studentId(manager, actor.id);
          if (item.estudiante?.id !== studentId) {
            const representative = item.grupo ? await manager.getRepository(GrupoIntegrante).findOne({ where: { grupo: { id: item.grupo.id }, estudiante: { id: studentId }, estado: GrupoIntegranteEstado.ACTIVO, rol_en_grupo: GrupoIntegranteRol.REPRESENTANTE } }) : null;
            if (!representative) throw new NotFoundException('No existe esa postulación visible para el usuario.');
          }
        }
        const before = { estado: item.estado, observacion: item.observacion };
        item.estado = EstadoPostulacion.CANCELADA; item.observacion = dto.motivo.trim();
        await repo.save(item);
        await this.auditoria.registrar(manager, { actor, accion: 'CANCELAR_POSTULACION', entidad_tipo: 'postulacion', entidad_id: item.id, valores_anteriores: before, valores_nuevos: { estado: item.estado, observacion: item.observacion }, ip_origen: ip });
      });
      return this.getRecord(periodoId, id);
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async list(periodoId: string, query: ListPostulacionesQueryDto, actor: Usuario, isAdmin: boolean): Promise<PagedPostulacionesResponseDto> {
    try {
      const period = await this.dataSource.getRepository(PeriodoTitulacion).findOneBy({ id: periodoId });
      if (!period) throw new NotFoundException('No existe el período indicado.');
      const qb = this.repository.createQueryBuilder('p').leftJoinAndSelect('p.periodo', 'period')
        .leftJoinAndSelect('p.tema', 'topic').leftJoinAndSelect('topic.linea', 'line')
        .leftJoinAndSelect('topic.docente_proponente', 'teacher').leftJoinAndSelect('teacher.usuario', 'teacherUser')
        .leftJoinAndSelect('p.grupo', 'group').leftJoinAndSelect('p.estudiante', 'owner').leftJoinAndSelect('owner.usuario', 'ownerUser')
        .leftJoinAndSelect('p.registrada_por', 'registrar').where('period.id = :periodoId', { periodoId });
      if (query.tema_id) qb.andWhere('topic.id = :temaId', { temaId: query.tema_id });
      if (query.estado) qb.andWhere('p.estado = :state', { state: query.estado });
      if (query.modalidad === ModalidadPostulacion.INDIVIDUAL) qb.andWhere('p.estudiante_id IS NOT NULL');
      if (query.modalidad === ModalidadPostulacion.GRUPAL) qb.andWhere('p.grupo_id IS NOT NULL');
      if (!isAdmin) qb.andWhere('teacherUser.id = :actorId', { actorId: actor.id });
      const [items, total] = await qb.orderBy('p.fecha_postulacion', 'DESC').addOrderBy('p.id', 'ASC').skip((query.page - 1) * query.limit).take(query.limit).getManyAndCount();
      return { data: await Promise.all(items.map((item) => this.toResponse(item))), total, page: query.page, limit: query.limit };
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async listMine(periodoId: string, actor: Usuario, query: ListPostulacionesQueryDto): Promise<PagedPostulacionesResponseDto> {
    try {
      const period = await this.dataSource.getRepository(PeriodoTitulacion).findOneBy({ id: periodoId });
      if (!period) throw new NotFoundException('No existe el período indicado.');
      const student = await this.students.findOne({ where: { usuario: { id: actor.id } } });
      if (!student) throw new NotFoundException('No tienes perfil de estudiante.');
      const membership = await this.members.findOne({ where: { periodo: { id: periodoId }, estudiante: { id: student.id }, estado: GrupoIntegranteEstado.ACTIVO }, relations: { grupo: true } });
      const qb = this.baseQuery(periodoId);
      qb.andWhere('(p.estudiante_id = :studentId OR p.grupo_id = :groupId)', { studentId: student.id, groupId: membership?.grupo.id ?? null });
      if (query.tema_id) qb.andWhere('topic.id = :temaId', { temaId: query.tema_id });
      if (query.estado) qb.andWhere('p.estado = :state', { state: query.estado });
      if (query.modalidad === ModalidadPostulacion.INDIVIDUAL) qb.andWhere('p.estudiante_id IS NOT NULL');
      if (query.modalidad === ModalidadPostulacion.GRUPAL) qb.andWhere('p.grupo_id IS NOT NULL');
      const [items, total] = await qb.orderBy('p.fecha_postulacion', 'DESC').addOrderBy('p.id', 'ASC').skip((query.page - 1) * query.limit).take(query.limit).getManyAndCount();
      return { data: await Promise.all(items.map((item) => this.toResponse(item))), total, page: query.page, limit: query.limit };
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async getById(periodoId: string, id: string, actor: Usuario, isAdmin: boolean): Promise<PostulacionResponseDto> {
    try {
      const item = await this.repository.findOne({ where: { id, periodo: { id: periodoId } }, relations });
      if (!item) throw new NotFoundException('No existe esa postulación en el período indicado.');
      if (!isAdmin) {
        if (actor.rol === 'DOCENTE') {
          if (item.tema.docente_proponente.usuario.id !== actor.id) throw new NotFoundException('No existe esa postulación visible para el usuario.');
        } else {
          const student = await this.students.findOne({ where: { usuario: { id: actor.id } } });
          const participant = item.estudiante?.id === student?.id || (!!item.grupo && !!student && !!await this.members.findOne({ where: { grupo: { id: item.grupo.id }, estudiante: { id: student.id }, estado: GrupoIntegranteEstado.ACTIVO } }));
          if (!participant) throw new NotFoundException('No existe esa postulación visible para el usuario.');
        }
      }
      return this.toResponse(item);
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  private baseQuery(periodoId: string) {
    return this.repository.createQueryBuilder('p').leftJoinAndSelect('p.periodo', 'period')
      .leftJoinAndSelect('p.tema', 'topic').leftJoinAndSelect('topic.linea', 'line')
      .leftJoinAndSelect('topic.docente_proponente', 'teacher').leftJoinAndSelect('teacher.usuario', 'teacherUser')
      .leftJoinAndSelect('p.grupo', 'group').leftJoinAndSelect('p.estudiante', 'owner').leftJoinAndSelect('owner.usuario', 'ownerUser')
      .leftJoinAndSelect('p.registrada_por', 'registrar').where('period.id = :periodoId', { periodoId });
  }

  private async toResponse(item: Postulacion): Promise<PostulacionResponseDto> {
    let participantIds: string[] = [];
    if (item.estudiante) participantIds = [item.estudiante.id];
    else if (item.grupo) participantIds = (await this.members.find({ where: { grupo: { id: item.grupo.id }, estado: GrupoIntegranteEstado.ACTIVO }, relations: { estudiante: { usuario: true } }, order: { fecha_ingreso: 'ASC', id: 'ASC' } })).map((member) => member.estudiante.id);
    const participants = await Promise.all(participantIds.map(async (participantId) => {
      const student = await this.students.findOne({ where: { id: participantId }, relations: { usuario: true } });
      const enabled = await this.dataSource.getRepository(EstudianteHabilitado).findOne({ where: { periodo: { id: item.periodo.id }, estudiante: { id: participantId } } });
      return student ? { id: student.id, nombres: student.usuario.nombres, apellidos: student.usuario.apellidos, matricula: student.matricula, habilitado: enabled?.estado ?? null, situacion_ingreso: enabled?.situacion_ingreso ?? null } : null;
    }));
    return { id: item.id, periodo_id: item.periodo.id, tema_id: item.tema.id,
      tema: { id: item.tema.id, titulo: item.tema.titulo, min_integrantes: item.tema.min_integrantes, max_integrantes: item.tema.max_integrantes, estado: item.tema.estado },
      grupo_id: item.grupo?.id ?? null, grupo: item.grupo ? { id: item.grupo.id, nombre: item.grupo.nombre } : null,
      estudiante_id: item.estudiante?.id ?? null, participantes: participants.filter((person): person is NonNullable<typeof person> => person !== null),
      num_integrantes: item.num_integrantes, registrada_por_id: item.registrada_por.id,
      registrada_por: { id: item.registrada_por.id, nombres: item.registrada_por.nombres, apellidos: item.registrada_por.apellidos },
      estado: item.estado, fecha_postulacion: item.fecha_postulacion, observacion: item.observacion };
  }

  private async lockPeriod(manager: EntityManager, id: string): Promise<PeriodoTitulacion> {
    const period = await manager.getRepository(PeriodoTitulacion).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!period) throw new NotFoundException('No existe el período indicado.');
    return period;
  }
  private schemaName(manager: EntityManager): string {
    const schema = (manager.connection.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new ServiceUnavailableException('El esquema PostgreSQL configurado no es válido.');
    return `"${schema}"`;
  }
  private async getRecord(periodoId: string, id: string): Promise<PostulacionResponseDto> {
    const item = await this.repository.findOne({ where: { id, periodo: { id: periodoId } }, relations });
    if (!item) throw new NotFoundException('No existe esa postulación en el período indicado.');
    return this.toResponse(item);
  }
  private assertStudentWindow(period: PeriodoTitulacion): void {
    const now = Date.now();
    if (period.estado !== PeriodoEstado.POSTULACION_ABIERTA || now < period.fecha_inicio_postulacion.getTime() || now >= period.fecha_fin_postulacion.getTime()) throw new ConflictException('El período está fuera del plazo de postulación.');
  }
  private async studentId(manager: EntityManager, userId: string): Promise<string> {
    const student = await manager.getRepository(Estudiante).findOne({ where: { usuario: { id: userId } } });
    if (!student) throw new NotFoundException('No tienes perfil de estudiante.');
    return student.id;
  }
  private handleDatabaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (error instanceof QueryFailedError) {
      const code = (error.driverError as DriverError).code;
      if (code === '23505') throw new ConflictException('Ya existe una postulación activa incompatible para el participante o el tema.');
      if (code === '23503' || code === '23514') throw new ConflictException('La operación incumple el plazo, rango o integridad de una postulación.');
    }
    throw new ServiceUnavailableException('No fue posible completar la operación de postulaciones.');
  }
}
