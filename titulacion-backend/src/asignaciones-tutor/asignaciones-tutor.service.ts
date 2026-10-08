import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { CargaTutorialPersistenciaService } from '../carga-tutorial/carga-tutorial-persistencia.service.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { GrupoIntegrante } from '../grupos/entities/grupo-integrante.entity.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { AsignacionTema } from '../asignaciones-tema/entities/asignacion-tema.entity.js';
import { AsignacionTemaEstado } from '../asignaciones-tema/enums/asignacion-tema-estado.enum.js';
import { EstadoTema } from '../temas/enums/estado-tema.enum.js';
import { ModalidadPostulacion } from '../postulaciones/enums/modalidad-postulacion.enum.js';
import { TutorPropuesto } from '../postulaciones/entities/tutor-propuesto.entity.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { AsignacionTutor } from './entities/asignacion-tutor.entity.js';
import { AsignacionTutorEstado } from './enums/asignacion-tutor-estado.enum.js';
import { AsignacionTutorTipo } from './enums/asignacion-tutor-tipo.enum.js';
import { AsignarTutorDto } from './dto/asignar-tutor.dto.js';
import { ReemplazarTutorDto } from './dto/reemplazar-tutor.dto.js';
import { ListAsignacionesTutorQueryDto } from './dto/list-asignaciones-tutor-query.dto.js';
import { AsignacionTutorResponseDto, CargaProyectadaResponseDto, CargaTutorActualResponseDto, PagedAsignacionTutorResponseDto, ParticipanteTutorResponseDto, ResultadoAsignacionTutorResponseDto } from './dto/asignacion-tutor-response.dto.js';
import { PagedTutorPropuestoAsignacionResponseDto, TutorPropuestoAsignacionResponseDto } from './dto/tutor-propuesto-asignacion-response.dto.js';

interface DriverError { code?: string; constraint?: string }
interface ChargeEval {
  actual: number;
  proyectada: number;
  excede_limite: boolean;
  origen: 'DOCENTE' | 'GLOBAL';
  configuracion: { id: string; max_trabajos: number; bloquear_al_superar: boolean };
  advertencia: string | null;
}

const relations = {
  asignacion_tema: { tema: true, postulacion: { grupo: true, estudiante: true } },
  docente: { usuario: true },
  asignada_por: true,
  tutor_propuesto: true,
} as const;

@Injectable()
export class AsignacionesTutorService {
  constructor(
    @InjectRepository(AsignacionTutor) private readonly repository: Repository<AsignacionTutor>,
    @InjectRepository(AsignacionTema) private readonly trabajos: Repository<AsignacionTema>,
    @InjectRepository(PeriodoTitulacion) private readonly periodos: Repository<PeriodoTitulacion>,
    @InjectRepository(Docente) private readonly docentes: Repository<Docente>,
    @InjectRepository(Estudiante) private readonly estudiantes: Repository<Estudiante>,
    @InjectRepository(GrupoIntegrante) private readonly integrantes: Repository<GrupoIntegrante>,
    @InjectRepository(TutorPropuesto) private readonly propuestas: Repository<TutorPropuesto>,
    private readonly dataSource: DataSource,
    private readonly auditoria: AuditoriaService,
    private readonly cargaTutorial: CargaTutorialPersistenciaService,
  ) {}

  async asignar(periodoId: string, trabajoId: string, dto: AsignarTutorDto, actor: Usuario, ip: string | null): Promise<ResultadoAsignacionTutorResponseDto> {
    try {
      const outcome = await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
        const periodo = await this.lockPeriod(manager, periodoId);
        this.assertOperable(periodo);
        const trabajo = await this.lockWork(manager, periodoId, trabajoId);
        this.assertWorkAssigned(trabajo);
        const existing = await manager.getRepository(AsignacionTutor).findOne({
          where: { asignacion_tema_id: trabajo.id, estado: AsignacionTutorEstado.VIGENTE },
          lock: { mode: 'pessimistic_write' },
        });
        if (existing) throw new ConflictException('El trabajo ya tiene un tutor vigente.');
        const docente = await this.lockEligibleTeacher(manager, dto.docente_id);
        const propuesta = dto.tutor_propuesto_id
          ? await this.lockProposal(manager, dto.tutor_propuesto_id, trabajo, docente.id)
          : null;
        const projected = await this.evaluarCarga(manager, periodoId, docente.id);
        this.assertCapacity(projected);
        const now = new Date();
        const repository = manager.getRepository(AsignacionTutor);
        const assignment = await repository.save(repository.create({
          asignacion_tema_id: trabajo.id,
          asignacion_tema: trabajo,
          docente_id: docente.id,
          docente,
          tutor_propuesto_id: propuesta?.id ?? null,
          tutor_propuesto: propuesta,
          tipo: propuesta ? AsignacionTutorTipo.PROPUESTO_CONFIRMADO : AsignacionTutorTipo.ASIGNADO_DIRECTO,
          estado: AsignacionTutorEstado.VIGENTE,
          asignada_por_id: actor.id,
          asignada_por: actor,
          fecha_asignacion: now,
          fecha_fin: null,
          motivo_cambio: null,
        }));
        await this.auditoria.registrar(manager, {
          actor, accion: 'ASIGNAR_TUTOR', entidad_tipo: 'asignacion_tutor', entidad_id: assignment.id,
          valores_anteriores: null,
          valores_nuevos: this.assignmentAudit(assignment, periodoId, projected),
          ip_origen: ip,
        });
        return { id: assignment.id, projected };
      });
      return this.operationResponse(periodoId, outcome.id, outcome.projected);
    } catch (error: unknown) { this.handleError(error); }
  }

  async reemplazar(periodoId: string, assignmentId: string, dto: ReemplazarTutorDto, actor: Usuario, ip: string | null): Promise<ResultadoAsignacionTutorResponseDto> {
    try {
      const outcome = await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
        const periodo = await this.lockPeriod(manager, periodoId);
        this.assertOperable(periodo);
        const initial = await manager.getRepository(AsignacionTutor).findOneBy({ id: assignmentId });
        if (!initial) throw new NotFoundException('No existe la asignación de tutor solicitada.');
        const trabajo = await this.lockWork(manager, periodoId, initial.asignacion_tema_id);
        this.assertWorkAssigned(trabajo);
        const repository = manager.getRepository(AsignacionTutor);
        const current = await repository.findOne({ where: { id: assignmentId, asignacion_tema_id: trabajo.id }, lock: { mode: 'pessimistic_write' } });
        if (!current) throw new NotFoundException('No existe la asignación de tutor solicitada.');
        if (current.estado !== AsignacionTutorEstado.VIGENTE) throw new ConflictException('Solo se puede reemplazar un tutor vigente.');
        if (current.docente_id === dto.docente_id) throw new ConflictException('El nuevo tutor debe ser distinto al tutor vigente.');
        const docente = await this.lockEligibleTeacher(manager, dto.docente_id);
        const propuesta = dto.tutor_propuesto_id
          ? await this.lockProposal(manager, dto.tutor_propuesto_id, trabajo, docente.id)
          : null;
        const projected = await this.evaluarCarga(manager, periodoId, docente.id);
        this.assertCapacity(projected);
        const before = this.assignmentAudit(current, periodoId, null);
        const now = new Date();
        current.estado = AsignacionTutorEstado.REEMPLAZADA;
        current.fecha_fin = now;
        current.motivo_cambio = dto.motivo.trim();
        await repository.save(current);
        const next = await repository.save(repository.create({
          asignacion_tema_id: trabajo.id,
          asignacion_tema: trabajo,
          docente_id: docente.id,
          docente,
          tutor_propuesto_id: propuesta?.id ?? null,
          tutor_propuesto: propuesta,
          tipo: propuesta ? AsignacionTutorTipo.PROPUESTO_CONFIRMADO : AsignacionTutorTipo.ASIGNADO_DIRECTO,
          estado: AsignacionTutorEstado.VIGENTE,
          asignada_por_id: actor.id,
          asignada_por: actor,
          fecha_asignacion: now,
          fecha_fin: null,
          motivo_cambio: null,
        }));
        await this.auditoria.registrar(manager, {
          actor, accion: 'REEMPLAZAR_TUTOR', entidad_tipo: 'asignacion_tutor', entidad_id: next.id,
          valores_anteriores: before,
          valores_nuevos: { ...this.assignmentAudit(next, periodoId, projected), reemplaza_asignacion_tutor_id: current.id, motivo: dto.motivo.trim() },
          ip_origen: ip,
        });
        return { id: next.id, projected };
      });
      return this.operationResponse(periodoId, outcome.id, outcome.projected);
    } catch (error: unknown) { this.handleError(error); }
  }

  async listarPropuestos(periodoId: string, trabajoId: string, page: number, limit: number): Promise<PagedTutorPropuestoAsignacionResponseDto> {
    try {
      const work = await this.trabajos.findOne({ where: { id: trabajoId, periodo_id: periodoId }, relations: { tema: { docente_proponente: true }, postulacion: true } });
      if (!work) throw new NotFoundException('No existe el trabajo asignado en el período indicado.');
      const qb = this.propuestas.createQueryBuilder('proposal')
        .innerJoinAndSelect('proposal.docente', 'docente')
        .innerJoinAndSelect('docente.usuario', 'user')
        .where('proposal.postulacion_id = :applicationId', { applicationId: work.postulacion_id })
        .addSelect('CASE WHEN docente.id = :proponentId THEN 0 ELSE 1 END', 'proponent_order')
        .setParameter('proponentId', work.tema.docente_proponente.id)
        .orderBy('proponent_order', 'ASC')
        .addOrderBy('proposal.orden_prioridad', 'ASC')
        .addOrderBy('proposal.id', 'ASC')
        .skip((page - 1) * limit)
        .take(limit);
      const [rows, total] = await qb.getManyAndCount();
      return {
        data: rows.map((row) => this.proposalResponse(row, work.tema.docente_proponente.id)),
        total, page, limit,
      };
    } catch (error: unknown) { this.handleError(error); }
  }

  async list(periodoId: string, query: ListAsignacionesTutorQueryDto): Promise<PagedAsignacionTutorResponseDto> {
    try {
      if (!await this.periodos.exist({ where: { id: periodoId } })) throw new NotFoundException('No existe el período indicado.');
      const qb = this.queryAssignments(periodoId);
      if (query.docente_id) qb.andWhere('tutor.docente_id = :teacherId', { teacherId: query.docente_id });
      if (query.asignacion_tema_id) qb.andWhere('tutor.asignacion_tema_id = :workId', { workId: query.asignacion_tema_id });
      if (query.estado) qb.andWhere('tutor.estado = :state', { state: query.estado });
      if (query.tipo) qb.andWhere('tutor.tipo = :type', { type: query.tipo });
      const [rows, total] = await qb.orderBy('tutor.fecha_asignacion', 'DESC').addOrderBy('tutor.id', 'ASC').skip((query.page - 1) * query.limit).take(query.limit).getManyAndCount();
      return { data: await Promise.all(rows.map((row) => this.toResponse(row))), total, page: query.page, limit: query.limit };
    } catch (error: unknown) { this.handleError(error); }
  }

  async listMine(periodoId: string, actor: Usuario, query: ListAsignacionesTutorQueryDto): Promise<PagedAsignacionTutorResponseDto> {
    try {
      if (!await this.periodos.exist({ where: { id: periodoId } })) throw new NotFoundException('No existe el período indicado.');
      if (query.docente_id) throw new ForbiddenException('No puedes consultar la carga de otra persona desde esta ruta.');
      const qb = this.queryAssignments(periodoId);
      if (actor.rol === UsuarioRol.DOCENTE) {
        const teacher = await this.docentes.findOne({ where: { usuario: { id: actor.id } } });
        if (!teacher) throw new NotFoundException('La cuenta no tiene un perfil docente.');
        qb.andWhere('tutor.docente_id = :teacherId', { teacherId: teacher.id });
      } else {
        const student = await this.estudiantes.findOne({ where: { usuario: { id: actor.id } } });
        if (!student) throw new NotFoundException('La cuenta no tiene un perfil de estudiante.');
        const schema = this.schema(this.dataSource.manager);
        qb.andWhere(`(work.estudiante_id = :studentId OR EXISTS (
          SELECT 1 FROM ${schema}."grupo_integrante" member
          WHERE member."grupo_id" = work.grupo_id AND member."estudiante_id" = :studentId
        ))`, { studentId: student.id });
      }
      if (query.asignacion_tema_id) qb.andWhere('tutor.asignacion_tema_id = :workId', { workId: query.asignacion_tema_id });
      if (query.estado) qb.andWhere('tutor.estado = :state', { state: query.estado });
      if (query.tipo) qb.andWhere('tutor.tipo = :type', { type: query.tipo });
      const [rows, total] = await qb.orderBy('tutor.fecha_asignacion', 'DESC').addOrderBy('tutor.id', 'ASC').skip((query.page - 1) * query.limit).take(query.limit).getManyAndCount();
      return { data: await Promise.all(rows.map((row) => this.toResponse(row))), total, page: query.page, limit: query.limit };
    } catch (error: unknown) { this.handleError(error); }
  }

  async getById(periodoId: string, id: string, actor: Usuario): Promise<AsignacionTutorResponseDto> {
    try {
      const record = await this.repository.findOne({ where: { id }, relations });
      if (!record || record.asignacion_tema.periodo_id !== periodoId) throw new NotFoundException('No existe esa asignación de tutor en el período indicado.');
      if (actor.rol === UsuarioRol.DOCENTE && record.docente.usuario.id !== actor.id) throw new NotFoundException('No existe esa asignación visible para el usuario.');
      if (actor.rol === UsuarioRol.ESTUDIANTE && !await this.isParticipant(record.asignacion_tema, actor.id)) throw new NotFoundException('No existe esa asignación visible para el usuario.');
      return this.toResponse(record);
    } catch (error: unknown) { this.handleError(error); }
  }

  async cargaActual(periodoId: string, docenteId: string): Promise<CargaTutorActualResponseDto> {
    try {
      if (!await this.periodos.exist({ where: { id: periodoId } })) throw new NotFoundException('No existe el período indicado.');
      if (!await this.docentes.exist({ where: { id: docenteId } })) throw new NotFoundException('No existe el perfil docente indicado.');
      const effective = await this.cargaTutorial.resolverConfiguracionEfectiva(this.dataSource.manager, periodoId, docenteId);
      const actual = await this.cargaTutorial.contarCargaActual(this.dataSource.manager, periodoId, docenteId);
      const config = effective.configuracion;
      return {
        periodo_id: periodoId,
        docente_id: docenteId,
        carga_actual: actual,
        excede_limite: config ? actual > config.max_trabajos : null,
        origen: effective.origen,
        configuracion: config ? { id: config.id, max_trabajos: config.max_trabajos, bloquear_al_superar: config.bloquear_al_superar } : null,
      };
    } catch (error: unknown) { this.handleError(error); }
  }

  async cargaDeUsuario(periodoId: string, actor: Usuario): Promise<CargaTutorActualResponseDto> {
    const teacher = await this.docentes.findOne({ where: { usuario: { id: actor.id } } });
    if (!teacher) throw new NotFoundException('La cuenta no tiene un perfil docente.');
    return this.cargaActual(periodoId, teacher.id);
  }

  private async operationResponse(periodoId: string, id: string, projected: ChargeEval): Promise<ResultadoAsignacionTutorResponseDto> {
    const record = await this.repository.findOne({ where: { id }, relations });
    if (!record) throw new NotFoundException('No se pudo recuperar la asignación registrada.');
    const carga: CargaProyectadaResponseDto = {
      actual: projected.actual,
      proyectada: projected.proyectada,
      excede_limite: projected.excede_limite,
      origen: projected.origen,
      configuracion: {
        id: projected.configuracion.id,
        max_trabajos: projected.configuracion.max_trabajos,
        bloquear_al_superar: projected.configuracion.bloquear_al_superar,
      },
    };
    return { asignacion: await this.toResponse(record), carga, advertencias: projected.advertencia ? [projected.advertencia] : [] };
  }

  private queryAssignments(periodoId: string) {
    return this.repository.createQueryBuilder('tutor')
      .innerJoinAndSelect('tutor.asignacion_tema', 'work')
      .innerJoinAndSelect('work.tema', 'topic')
      .innerJoinAndSelect('work.postulacion', 'application')
      .leftJoinAndSelect('application.grupo', 'group')
      .leftJoinAndSelect('application.estudiante', 'student')
      .innerJoinAndSelect('tutor.docente', 'teacher')
      .innerJoinAndSelect('teacher.usuario', 'teacherUser')
      .innerJoinAndSelect('tutor.asignada_por', 'responsable')
      .where('work.periodo_id = :periodoId', { periodoId });
  }

  private async toResponse(record: AsignacionTutor): Promise<AsignacionTutorResponseDto> {
    const work = record.asignacion_tema;
    const participants = await this.participants(work.estudiante_id, work.grupo_id);
    return {
      id: record.id,
      periodo_id: work.periodo_id,
      asignacion_tema_id: work.id,
      docente_id: record.docente_id,
      tutor_propuesto_id: record.tutor_propuesto_id,
      tipo: record.tipo,
      estado: record.estado,
      asignada_por_id: record.asignada_por_id,
      fecha_asignacion: record.fecha_asignacion,
      fecha_fin: record.fecha_fin,
      motivo_cambio: record.motivo_cambio,
      docente: {
        id: record.docente.id,
        nombres: record.docente.usuario.nombres,
        apellidos: record.docente.usuario.apellidos,
        titulo_academico: record.docente.titulo_academico,
        departamento: record.docente.departamento,
      },
      responsable: {
        id: record.asignada_por.id,
        nombres: record.asignada_por.nombres,
        apellidos: record.asignada_por.apellidos,
      },
      trabajo: {
        id: work.id,
        tema: { id: work.tema.id, titulo: work.tema.titulo },
        postulacion: {
          id: work.postulacion.id,
          modalidad: work.grupo_id ? ModalidadPostulacion.GRUPAL : ModalidadPostulacion.INDIVIDUAL,
          num_integrantes: work.postulacion.num_integrantes,
        },
        grupo: work.postulacion.grupo ? { id: work.postulacion.grupo.id, nombre: work.postulacion.grupo.nombre } : null,
        participantes: participants,
      },
    };
  }

  private async participants(estudianteId: string | null, grupoId: string | null): Promise<ParticipanteTutorResponseDto[]> {
    const schema = this.schema(this.dataSource.manager);
    return this.dataSource.query(`
      SELECT e."id",u."nombres",u."apellidos",e."matricula"
      FROM ${schema}."estudiante" e JOIN ${schema}."usuario" u ON u."id"=e."usuario_id"
      WHERE ($1::uuid IS NOT NULL AND e."id"=$1)
         OR ($2::uuid IS NOT NULL AND EXISTS (
           SELECT 1 FROM ${schema}."grupo_integrante" member
           WHERE member."grupo_id"=$2 AND member."estudiante_id"=e."id"
         ))
      ORDER BY e."id"`, [estudianteId, grupoId]) as Promise<ParticipanteTutorResponseDto[]>;
  }

  private async isParticipant(work: AsignacionTema, usuarioId: string): Promise<boolean> {
    const student = await this.estudiantes.findOne({ where: { usuario: { id: usuarioId } } });
    if (!student) return false;
    if (work.estudiante_id === student.id) return true;
    if (!work.grupo_id) return false;
    return this.integrantes.exist({ where: { grupo: { id: work.grupo_id }, estudiante: { id: student.id } } });
  }

  private async lockPeriod(manager: EntityManager, id: string): Promise<PeriodoTitulacion> {
    const period = await manager.getRepository(PeriodoTitulacion).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!period) throw new NotFoundException('No existe el período indicado.');
    return period;
  }

  private async lockWork(manager: EntityManager, periodoId: string, id: string): Promise<AsignacionTema> {
    const workRepo = manager.getRepository(AsignacionTema);
    const locked = await workRepo.findOne({ where: { id, periodo_id: periodoId }, lock: { mode: 'pessimistic_write' } });
    if (!locked) throw new NotFoundException('No existe el trabajo asignado en el período indicado.');
    const work = await workRepo.findOne({ where: { id }, relations: { tema: true, postulacion: { grupo: true, estudiante: true } } });
    if (!work) throw new NotFoundException('No existe el trabajo asignado en el período indicado.');
    return work;
  }

  private async lockEligibleTeacher(manager: EntityManager, id: string): Promise<Docente> {
    const teacher = await manager.getRepository(Docente).createQueryBuilder('docente')
      .innerJoinAndSelect('docente.usuario', 'usuario')
      .where('docente.id = :id', { id })
      .setLock('pessimistic_write', undefined, ['docente', 'usuario'])
      .getOne();
    if (!teacher) throw new ConflictException('El docente seleccionado no tiene un perfil vigente.');
    if (!teacher.habilitado_tutoria || teacher.usuario.estado !== UsuarioEstado.ACTIVO || teacher.usuario.rol !== UsuarioRol.DOCENTE) {
      throw new ConflictException('El tutor debe tener cuenta activa, rol DOCENTE y habilitación para tutoría.');
    }
    return teacher;
  }

  private async lockProposal(manager: EntityManager, id: string, work: AsignacionTema, docenteId: string): Promise<TutorPropuesto> {
    const proposal = await manager.getRepository(TutorPropuesto).findOne({
      where: { id, postulacion: { id: work.postulacion_id }, docente: { id: docenteId } },
    });
    if (!proposal) throw new ConflictException('La preferencia no pertenece a la postulación o docente elegidos.');
    return proposal;
  }

  private async evaluarCarga(manager: EntityManager, periodoId: string, docenteId: string): Promise<ChargeEval> {
    const evaluated = await this.cargaTutorial.evaluarCargaProyectada(manager, periodoId, docenteId);
    return {
      actual: evaluated.actual,
      proyectada: evaluated.proyectada,
      excede_limite: evaluated.excede_limite,
      origen: evaluated.origen,
      configuracion: {
        id: evaluated.configuracion.id,
        max_trabajos: evaluated.configuracion.max_trabajos,
        bloquear_al_superar: evaluated.configuracion.bloquear_al_superar,
      },
      advertencia: evaluated.advertencia,
    };
  }

  private assertCapacity(evaluated: ChargeEval): void {
    if (evaluated.excede_limite && evaluated.configuracion.bloquear_al_superar) {
      throw new ConflictException(`La asignación superaría el máximo de carga configurado (${evaluated.configuracion.max_trabajos}).`);
    }
  }

  private assertOperable(period: PeriodoTitulacion): void {
    if (![PeriodoEstado.POSTULACION_CERRADA, PeriodoEstado.EN_CURSO].includes(period.estado)) {
      throw new ConflictException('La asignación de tutores requiere un período POSTULACION_CERRADA o EN_CURSO.');
    }
  }

  private assertWorkAssigned(work: AsignacionTema): void {
    if (work.estado !== AsignacionTemaEstado.VIGENTE || work.tema.estado !== EstadoTema.ASIGNADO || work.postulacion.estado !== 'ACEPTADA') {
      throw new ConflictException('El tutor solo se asigna a un trabajo vigente, con tema asignado y postulación aceptada.');
    }
  }

  private assignmentAudit(item: AsignacionTutor, periodoId: string, charge: ChargeEval | null): Record<string, unknown> {
    return {
      periodo_id: periodoId,
      asignacion_tema_id: item.asignacion_tema_id,
      docente_id: item.docente_id,
      tutor_propuesto_id: item.tutor_propuesto_id,
      tipo: item.tipo,
      estado: item.estado,
      asignada_por_id: item.asignada_por_id,
      fecha_asignacion: item.fecha_asignacion,
      carga: charge ? {
        actual: charge.actual,
        proyectada: charge.proyectada,
        origen: charge.origen,
        configuracion_id: charge.configuracion.id,
        max_trabajos: charge.configuracion.max_trabajos,
        bloquear_al_superar: charge.configuracion.bloquear_al_superar,
      } : null,
    };
  }

  private proposalResponse(proposal: TutorPropuesto, proponentId: string): TutorPropuestoAsignacionResponseDto {
    const teacher = proposal.docente;
    return {
      id: proposal.id,
      docente_id: teacher.id,
      orden_prioridad: proposal.orden_prioridad,
      es_proponente_tema: teacher.id === proponentId,
      elegible_actualmente: teacher.habilitado_tutoria && teacher.usuario.estado === UsuarioEstado.ACTIVO && teacher.usuario.rol === UsuarioRol.DOCENTE,
      docente: {
        id: teacher.id,
        nombres: teacher.usuario.nombres,
        apellidos: teacher.usuario.apellidos,
        titulo_academico: teacher.titulo_academico,
        departamento: teacher.departamento,
      },
    };
  }

  private schema(manager: EntityManager): string {
    const schema = (manager.connection.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new ServiceUnavailableException('El esquema PostgreSQL configurado no es válido.');
    return `"${schema}"`;
  }

  private handleError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (error instanceof QueryFailedError) {
      const driver = error.driverError as DriverError;
      if (['23505', '23503', '23514'].includes(driver.code ?? '')) throw new ConflictException('La asignación incumple una regla de tutoría, referencia o carga configurada.');
      if (driver.code === '40001' || driver.code === '40P01') throw new ConflictException('La operación coincidió con otro cambio simultáneo. Vuelve a intentarlo.');
    }
    throw new ServiceUnavailableException('No fue posible completar la operación de tutoría en PostgreSQL.');
  }
}
