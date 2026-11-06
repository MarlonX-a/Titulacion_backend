import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, QueryFailedError, Repository, type FindOptionsWhere } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { AsignacionTema } from '../asignaciones-tema/entities/asignacion-tema.entity.js';
import { AsignacionTemaEstado } from '../asignaciones-tema/enums/asignacion-tema-estado.enum.js';
import { AcademicoService } from '../academico/academico.service.js';
import { resumenCatalogo, type CatalogoAcademico } from '../academico/catalogo-academico.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { NotificacionTipo } from '../notificaciones/enums/notificacion-canal.enum.js';
import { NotificacionesPersistenciaService } from '../notificaciones/notificaciones-persistencia.service.js';
import { Postulacion } from '../postulaciones/entities/postulacion.entity.js';
import { EstadoPostulacion } from '../postulaciones/enums/estado-postulacion.enum.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { EstudianteHabilitado } from '../habilitados/entities/estudiante-habilitado.entity.js';
import { HabilitadoEstado } from '../habilitados/enums/habilitado-estado.enum.js';
import { SituacionIngreso } from '../habilitados/enums/situacion-ingreso.enum.js';
import { LineaInvestigacion } from '../lineas-investigacion/entities/linea-investigacion.entity.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import type { ConsultaTemaQueryDto } from './dto/consulta-tema-query.dto.js';
import { CreateTemaDto } from './dto/create-tema.dto.js';
import { ListTemasQueryDto } from './dto/list-temas-query.dto.js';
import type { MotivoTemaDto } from './dto/motivo-tema.dto.js';
import type { PublicarTemaDto } from './dto/publicar-tema.dto.js';
import { TemaHistorialResponseDto } from './dto/tema-historial-response.dto.js';
import { TemaResponseDto } from './dto/tema-response.dto.js';
import { UpdateTemaDto } from './dto/update-tema.dto.js';
import { filtroEstados, puedeEditarse } from './disponibilidad-tema.js';
import { TemaHistorial } from './entities/tema-historial.entity.js';
import { Tema } from './entities/tema.entity.js';
import { EstadoTema } from './enums/estado-tema.enum.js';
import { integrantesPermitidos } from './integrantes-tema.js';

interface PostgresDriverError { code?: string; }
export interface PagedTemas { data: TemaResponseDto[]; total: number; page: number; limit: number; }
export interface PagedTemaHistorial { data: TemaHistorialResponseDto[]; total: number; page: number; limit: number; }

function schemaFrom(options: unknown): string {
  const value = (options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new ServiceUnavailableException('El esquema PostgreSQL configurado no es válido.');
  return `"${value}"`;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof QueryFailedError && (error.driverError as PostgresDriverError).code === code;
}

function temaValues(tema: Tema): Record<string, unknown> {
  return {
    carrera_id: tema.carrera_id,
    linea_id: tema.linea.id,
    docente_proponente_id: tema.docente_proponente.id,
    tipo: tema.tipo,
    titulo: tema.titulo,
    descripcion: tema.descripcion,
    estado: tema.estado,
    lote_importacion_id: tema.lote_importacion_id ?? null,
    creado_en: tema.creado_en,
  };
}

function responseFrom(tema: Tema, catalogo: CatalogoAcademico, maxGrupo?: number): TemaResponseDto {
  const rango = integrantesPermitidos(tema.tipo, maxGrupo);
  return {
    id: tema.id,
    carrera_id: tema.carrera_id,
    carrera: resumenCatalogo(catalogo.carrera(tema.carrera_id), tema.carrera_id),
    linea_id: tema.linea.id,
    linea: { id: tema.linea.id, codigo: tema.linea.codigo, nombre: tema.linea.nombre },
    docente_proponente_id: tema.docente_proponente.id,
    docente_proponente: {
      id: tema.docente_proponente.id,
      nombres: tema.docente_proponente.usuario.nombres,
      apellidos: tema.docente_proponente.usuario.apellidos,
    },
    titulo: tema.titulo,
    descripcion: tema.descripcion,
    tipo: tema.tipo,
    min_integrantes: rango.min,
    max_integrantes: rango.max,
    estado: tema.estado,
    lote_importacion_id: tema.lote_importacion_id ?? null,
    creado_en: tema.creado_en,
    disponible: tema.estado === EstadoTema.PUBLICADO,
    postulaciones_abiertas: 0,
  };
}

function historialResponseFrom(item: TemaHistorial): TemaHistorialResponseDto {
  return {
    id: item.id,
    tema_id: item.tema.id,
    usuario_id: item.usuario.id,
    responsable: { id: item.usuario.id, nombres: item.usuario.nombres, apellidos: item.usuario.apellidos },
    estado_anterior: item.estado_anterior,
    estado_nuevo: item.estado_nuevo,
    cambios: item.cambios,
    fecha: item.fecha,
  };
}

const temaRelations = { linea: true, docente_proponente: { usuario: true } } as const;

/** Career topic bank: topics are not bound to a period; applications and assignments carry the period. */
@Injectable()
export class TemasService {
  constructor(
    @InjectRepository(Tema) private readonly repository: Repository<Tema>,
    @InjectRepository(TemaHistorial) private readonly historialRepository: Repository<TemaHistorial>,
    @InjectRepository(Docente) private readonly docenteRepository: Repository<Docente>,
    @InjectRepository(Estudiante) private readonly estudianteRepository: Repository<Estudiante>,
    @InjectRepository(EstudianteHabilitado) private readonly habilitadoRepository: Repository<EstudianteHabilitado>,
    @InjectRepository(PeriodoTitulacion) private readonly periodoRepository: Repository<PeriodoTitulacion>,
    private readonly dataSource: DataSource,
    private readonly auditoria: AuditoriaService,
    private readonly notificaciones: NotificacionesPersistenciaService,
    private readonly academico: AcademicoService = new AcademicoService(),
  ) {}

  private async respuesta(tema: Tema, maxGrupo?: number): Promise<TemaResponseDto> {
    return responseFrom(tema, await this.academico.catalogo(this.dataSource), maxGrupo);
  }

  async create(dto: CreateTemaDto, actor: Usuario, ip: string | null): Promise<TemaResponseDto> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const carrera = await this.academico.buscarCarrera(this.dataSource, dto.carrera_id);
        const refs = await this.references(manager, dto.linea_id, dto.docente_proponente_id);
        await this.academico.assertMismaCarrera(this.dataSource, refs.docente.carrera_id, carrera.id, 'del docente proponente');
        const repo = manager.getRepository(Tema);
        const tema = await repo.save(repo.create({
          carrera_id: carrera.id, linea: refs.linea, docente_proponente: refs.docente, tipo: dto.tipo,
          titulo: dto.titulo.trim(), descripcion: dto.descripcion.trim(), estado: EstadoTema.BORRADOR, lote_importacion_id: null,
        }));
        const loaded = await this.loadForResponse(manager, tema.id);
        await this.writeHistory(manager, loaded, actor, null);
        await this.auditoria.registrar(manager, {
          actor, accion: 'CREAR_TEMA', entidad_tipo: 'tema', entidad_id: loaded.id,
          valores_anteriores: null, valores_nuevos: temaValues(loaded), ip_origen: ip,
        });
        return await this.respuesta(loaded);
      });
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async list(query: ListTemasQueryDto, actor: Usuario): Promise<PagedTemas> {
    try {
      const periodo = await this.contextPeriod(query.periodo_id);
      let carreraId = query.carrera_id;
      let estados = filtroEstados(query.estado, query.disponible);
      if (actor.rol === UsuarioRol.ESTUDIANTE) {
        if (!periodo) throw new BadRequestException('Indica el período (periodo_id) para consultar el catálogo de temas.');
        if (query.estado && query.estado !== EstadoTema.PUBLICADO) throw new ForbiddenException('Los estudiantes solo pueden consultar temas publicados.');
        const estudiante = await this.assertStudentCanViewCatalog(periodo, actor);
        carreraId = estudiante.carrera_id;
        estados = [EstadoTema.PUBLICADO];
      }
      let docenteId = query.docente_proponente_id;
      if (actor.rol === UsuarioRol.DOCENTE) {
        const docente = await this.docenteRepository.findOne({ where: { usuario: { id: actor.id } } });
        if (!docente) throw new NotFoundException('La cuenta aún no tiene perfil de docente.');
        if (docenteId && docenteId !== docente.id) throw new ForbiddenException('Solo puedes consultar tus temas propuestos.');
        docenteId = docente.id;
      }
      if (estados && estados.length === 0) return { data: [], total: 0, page: query.page, limit: query.limit };
      const where: FindOptionsWhere<Tema> = {
        ...(carreraId ? { carrera_id: carreraId } : {}),
        ...(query.linea_id ? { linea: { id: query.linea_id } } : {}),
        ...(docenteId ? { docente_proponente: { id: docenteId } } : {}),
        ...(query.tipo ? { tipo: query.tipo } : {}),
        ...(estados ? { estado: estados.length === 1 ? estados[0] : In(estados) } : {}),
      };
      const [records, total] = await this.repository.findAndCount({
        where,
        relations: temaRelations,
        order: { creado_en: 'DESC', id: 'ASC' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      const catalogo = await this.academico.catalogo(this.dataSource);
      const data = records.map((record) => responseFrom(record, catalogo, periodo?.max_integrantes_default));
      return { data: await this.enrichAvailability(periodo?.id ?? null, data), total, page: query.page, limit: query.limit };
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async getById(id: string, query: ConsultaTemaQueryDto, actor: Usuario): Promise<TemaResponseDto> {
    try {
      const periodo = await this.contextPeriod(query.periodo_id);
      let carreraEstudiante: string | null = null;
      if (actor.rol === UsuarioRol.ESTUDIANTE) {
        if (!periodo) throw new BadRequestException('Indica el período (periodo_id) para consultar el tema.');
        carreraEstudiante = (await this.assertStudentCanViewCatalog(periodo, actor)).carrera_id;
      }
      const tema = await this.repository.findOne({ where: { id }, relations: temaRelations });
      if (!tema) throw new NotFoundException('No existe el tema indicado.');
      if (carreraEstudiante !== null && (tema.estado !== EstadoTema.PUBLICADO || tema.carrera_id !== carreraEstudiante)) {
        throw new NotFoundException('No existe el tema indicado.');
      }
      if (actor.rol === UsuarioRol.DOCENTE) {
        const docente = await this.docenteRepository.findOne({ where: { usuario: { id: actor.id } } });
        if (!docente) throw new NotFoundException('La cuenta aún no tiene perfil de docente.');
        if (tema.docente_proponente.id !== docente.id) throw new NotFoundException('No existe el tema indicado.');
      }
      return (await this.enrichAvailability(periodo?.id ?? null, [await this.respuesta(tema, periodo?.max_integrantes_default)]))[0]!;
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async update(id: string, dto: UpdateTemaDto, actor: Usuario, ip: string | null): Promise<TemaResponseDto> {
    if (!Object.values(dto).some((value) => value !== undefined)) throw new BadRequestException('Debe indicar al menos un campo para editar.');
    try {
      return await this.dataSource.transaction(async (manager) => {
        const tema = await this.lockTema(manager, id);
        if (!puedeEditarse(tema.estado, await this.hasCurrentAssignment(manager, tema.id))) {
          throw new ConflictException('El tema tiene una asignación VIGENTE; anúlala antes de editarlo.');
        }
        const previous = temaValues(tema);
        const refs = await this.references(manager, dto.linea_id ?? tema.linea.id, dto.docente_proponente_id ?? tema.docente_proponente.id);
        const carreraId = dto.carrera_id ?? tema.carrera_id;
        if (dto.carrera_id !== undefined) await this.academico.buscarCarrera(this.dataSource, carreraId);
        await this.academico.assertMismaCarrera(this.dataSource, refs.docente.carrera_id, carreraId, 'del docente proponente');
        const tipo = dto.tipo ?? tema.tipo;
        if ((tipo !== tema.tipo || carreraId !== tema.carrera_id) && await this.openApplications(manager, tema.id) > 0) {
          throw new ConflictException('No se puede cambiar el tipo ni la carrera mientras el tema tiene postulaciones abiertas.');
        }
        tema.carrera_id = carreraId;
        tema.tipo = tipo;
        tema.linea = refs.linea;
        tema.docente_proponente = refs.docente;
        if (dto.titulo !== undefined) tema.titulo = dto.titulo.trim();
        if (dto.descripcion !== undefined) tema.descripcion = dto.descripcion.trim();
        if (JSON.stringify(previous) === JSON.stringify(temaValues(tema))) return await this.respuesta(tema);
        await manager.getRepository(Tema).save(tema);
        const loaded = await this.loadForResponse(manager, id);
        await this.writeHistory(manager, loaded, actor, previous);
        await this.auditoria.registrar(manager, {
          actor, accion: 'ACTUALIZAR_TEMA', entidad_tipo: 'tema', entidad_id: id,
          valores_anteriores: previous, valores_nuevos: temaValues(loaded), ip_origen: ip,
        });
        return await this.respuesta(loaded);
      });
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  /** Publishes a BORRADOR (active references required) or reopens a CERRADO topic without a VIGENTE assignment. */
  async publish(id: string, _dto: PublicarTemaDto, actor: Usuario, ip: string | null): Promise<TemaResponseDto> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const tema = await this.lockTema(manager, id);
        if (tema.estado === EstadoTema.CERRADO) return this.reopen(manager, tema, actor, ip);
        if (tema.estado !== EstadoTema.BORRADOR) {
          throw new ConflictException('Solo se pueden publicar temas en estado BORRADOR o reabrir temas CERRADOS.');
        }
        await this.references(manager, tema.linea.id, tema.docente_proponente.id);
        if (!tema.titulo.trim() || !tema.descripcion.trim()) throw new BadRequestException('El título y la descripción son obligatorios.');
        const previous = temaValues(tema);
        tema.estado = EstadoTema.PUBLICADO;
        await manager.getRepository(Tema).save(tema);
        const loaded = await this.loadForResponse(manager, id);
        await this.writeHistory(manager, loaded, actor, previous);
        await this.auditoria.registrar(manager, {
          actor, accion: 'PUBLICAR_TEMA', entidad_tipo: 'tema', entidad_id: id,
          valores_anteriores: previous, valores_nuevos: temaValues(loaded), ip_origen: ip,
        });
        return await this.respuesta(loaded);
      });
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  /** RF-25: PUBLICADO → CERRADO; rejects the topic's PENDIENTE or EN_CONFLICTO applications of every period. */
  async close(id: string, dto: MotivoTemaDto, actor: Usuario, ip: string | null): Promise<TemaResponseDto> {
    return this.endTopic(id, dto, actor, ip, EstadoTema.CERRADO);
  }

  /** RF-21: BORRADOR, PUBLICADO or CERRADO → RETIRADO (terminal); rejects its open applications. */
  async withdraw(id: string, dto: MotivoTemaDto, actor: Usuario, ip: string | null): Promise<TemaResponseDto> {
    return this.endTopic(id, dto, actor, ip, EstadoTema.RETIRADO);
  }

  async history(id: string, query: PaginationQueryDto): Promise<PagedTemaHistorial> {
    try {
      const tema = await this.repository.findOneBy({ id });
      if (!tema) throw new NotFoundException('No existe el tema indicado.');
      const [records, total] = await this.historialRepository.findAndCount({
        where: { tema: { id } }, relations: { tema: true, usuario: true }, order: { fecha: 'ASC', id: 'ASC' },
        skip: (query.page - 1) * query.limit, take: query.limit,
      });
      return { data: records.map(historialResponseFrom), total, page: query.page, limit: query.limit };
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  private async endTopic(id: string, dto: MotivoTemaDto, actor: Usuario, ip: string | null, destino: EstadoTema.CERRADO | EstadoTema.RETIRADO): Promise<TemaResponseDto> {
    const motivo = dto.motivo.trim();
    const cierre = destino === EstadoTema.CERRADO;
    try {
      return await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
        const tema = await this.lockTema(manager, id);
        if (tema.estado === EstadoTema.ASIGNADO || await this.hasCurrentAssignment(manager, tema.id)) {
          throw new ConflictException(`El tema tiene una asignación VIGENTE; anúlala antes de ${cierre ? 'cerrarlo' : 'retirarlo'}.`);
        }
        const origins = cierre ? [EstadoTema.PUBLICADO] : [EstadoTema.BORRADOR, EstadoTema.PUBLICADO, EstadoTema.CERRADO];
        if (!origins.includes(tema.estado)) {
          throw new ConflictException(cierre ? 'Solo se pueden cerrar temas PUBLICADOS.' : 'Solo se pueden retirar temas en BORRADOR, PUBLICADO o CERRADO.');
        }
        const previous = temaValues(tema);
        tema.estado = destino;
        await manager.getRepository(Tema).save(tema);
        const loaded = await this.loadForResponse(manager, id);
        await this.writeHistory(manager, loaded, actor, previous, motivo);
        await this.auditoria.registrar(manager, {
          actor, accion: cierre ? 'CERRAR_TEMA' : 'RETIRAR_TEMA', entidad_tipo: 'tema', entidad_id: id,
          valores_anteriores: previous, valores_nuevos: { ...temaValues(loaded), motivo }, ip_origen: ip,
        });
        await this.rejectOpenApplications(manager, id, `${cierre ? 'Tema cerrado' : 'Tema retirado'}: ${motivo}`, cierre ? 'RECHAZAR_POSTULACION_POR_CIERRE_TEMA' : 'RECHAZAR_POSTULACION_POR_RETIRO_TEMA', actor, ip);
        return await this.respuesta(loaded);
      });
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  private async reopen(manager: EntityManager, tema: Tema, actor: Usuario, ip: string | null): Promise<TemaResponseDto> {
    if (await this.hasCurrentAssignment(manager, tema.id)) throw new ConflictException('El tema tiene una asignación VIGENTE y no puede reabrirse.');
    const previous = temaValues(tema);
    tema.estado = EstadoTema.PUBLICADO;
    await manager.getRepository(Tema).save(tema);
    const loaded = await this.loadForResponse(manager, tema.id);
    await this.writeHistory(manager, loaded, actor, previous);
    await this.auditoria.registrar(manager, {
      actor, accion: 'REABRIR_TEMA', entidad_tipo: 'tema', entidad_id: tema.id,
      valores_anteriores: previous, valores_nuevos: temaValues(loaded), ip_origen: ip,
    });
    return await this.respuesta(loaded);
  }

  /** Applications are locked in id order after the topic, as in the assignment flow. */
  private async rejectOpenApplications(manager: EntityManager, temaId: string, observacion: string, accion: string, actor: Usuario, ip: string | null): Promise<void> {
    const rows = await manager.query(
      `SELECT "id" FROM ${schemaFrom(manager.connection.options)}."postulacion" WHERE "tema_id"=$1 AND "estado" IN ('PENDIENTE','EN_CONFLICTO') ORDER BY "id" FOR UPDATE`,
      [temaId],
    ) as Array<{ id: string }>;
    const repository = manager.getRepository(Postulacion);
    for (const row of rows) {
      const application = await repository.findOneBy({ id: row.id });
      if (!application || ![EstadoPostulacion.PENDIENTE, EstadoPostulacion.EN_CONFLICTO].includes(application.estado)) continue;
      const previous = { estado: application.estado, observacion: application.observacion };
      application.estado = EstadoPostulacion.RECHAZADA;
      application.observacion = observacion;
      await repository.save(application);
      await this.auditoria.registrar(manager, {
        actor, accion, entidad_tipo: 'postulacion', entidad_id: application.id,
        valores_anteriores: previous, valores_nuevos: { estado: application.estado, observacion }, ip_origen: ip,
      });
      await this.notificaciones.postulacion(manager, application.id, NotificacionTipo.POSTULACION_RECHAZADA, actor.id);
    }
  }

  private async openApplications(manager: EntityManager, temaId: string): Promise<number> {
    const rows = await manager.query(
      `SELECT count(*)::int AS total FROM ${schemaFrom(manager.connection.options)}."postulacion" WHERE "tema_id"=$1 AND "estado" IN ('PENDIENTE','EN_CONFLICTO')`,
      [temaId],
    ) as Array<{ total: number }>;
    return Number(rows[0]?.total ?? 0);
  }

  private hasCurrentAssignment(manager: EntityManager, temaId: string): Promise<boolean> {
    return manager.getRepository(AsignacionTema).exist({ where: { tema_id: temaId, estado: AsignacionTemaEstado.VIGENTE } });
  }

  private async contextPeriod(periodoId: string | undefined): Promise<PeriodoTitulacion | null> {
    if (!periodoId) return null;
    const periodo = await this.periodoRepository.findOneBy({ id: periodoId });
    if (!periodo) throw new NotFoundException('No existe el período indicado.');
    return periodo;
  }

  private async lockTema(manager: EntityManager, id: string): Promise<Tema> {
    const repository = manager.getRepository(Tema);
    const locked = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!locked) throw new NotFoundException('No existe el tema indicado.');
    const tema = await repository.findOne({ where: { id: locked.id }, relations: temaRelations });
    if (!tema) throw new NotFoundException('No existe el tema indicado.');
    return tema;
  }

  private async references(manager: EntityManager, lineaId: string, docenteId: string): Promise<{ linea: LineaInvestigacion; docente: Docente }> {
    const linea = await manager.getRepository(LineaInvestigacion).findOne({ where: { id: lineaId }, lock: { mode: 'pessimistic_write' } });
    if (!linea) throw new NotFoundException('No existe la línea de investigación indicada.');
    if (!linea.activa) throw new ConflictException('La línea de investigación está inactiva.');
    const docenteLocked = await manager.getRepository(Docente).findOne({ where: { id: docenteId }, lock: { mode: 'pessimistic_write' } });
    if (!docenteLocked) throw new NotFoundException('No existe el docente proponente indicado.');
    const docente = await manager.getRepository(Docente).findOne({ where: { id: docenteId }, relations: { usuario: true } });
    if (!docente) throw new NotFoundException('No existe el docente proponente indicado.');
    if (docente.usuario.estado !== UsuarioEstado.ACTIVO || docente.usuario.rol !== UsuarioRol.DOCENTE) throw new ConflictException('El docente proponente debe tener una cuenta activa con rol DOCENTE.');
    const lockedAccount = await manager.getRepository(Usuario).findOne({ where: { id: docente.usuario.id }, lock: { mode: 'pessimistic_write' } });
    if (!lockedAccount || lockedAccount.estado !== UsuarioEstado.ACTIVO || lockedAccount.rol !== UsuarioRol.DOCENTE) {
      throw new ConflictException('El docente proponente debe tener una cuenta activa con rol DOCENTE.');
    }
    return { linea, docente };
  }

  /** The student must be enabled in an open period; the catalog is then limited to the student's career. */
  private async assertStudentCanViewCatalog(periodo: PeriodoTitulacion, actor: Usuario): Promise<Estudiante> {
    if (periodo.estado !== PeriodoEstado.POSTULACION_ABIERTA) {
      throw new ForbiddenException('El catálogo estudiantil está disponible cuando el período está abierto.');
    }
    const estudiante = await this.estudianteRepository.findOne({ where: { usuario: { id: actor.id } } });
    if (!estudiante) throw new ForbiddenException('La cuenta no tiene un perfil de estudiante.');
    const habilitacion = await this.habilitadoRepository.findOne({
      where: { periodo: { id: periodo.id }, estudiante: { usuario: { id: actor.id } }, estado: HabilitadoEstado.HABILITADO },
      relations: { estudiante: true },
    });
    if (!habilitacion || ![SituacionIngreso.PENDIENTE, SituacionIngreso.ADMITIDO].includes(habilitacion.situacion_ingreso)) {
      throw new ForbiddenException('No tienes una habilitación vigente para consultar este catálogo.');
    }
    return estudiante;
  }

  private async loadForResponse(manager: EntityManager, id: string): Promise<Tema> {
    const record = await manager.getRepository(Tema).findOne({ where: { id }, relations: temaRelations });
    if (!record) throw new NotFoundException('No existe el tema indicado.');
    return record;
  }

  private async enrichAvailability(periodoId: string | null, responses: TemaResponseDto[]): Promise<TemaResponseDto[]> {
    if (responses.length === 0) return responses;
    const ids = responses.map((item) => item.id);
    const schema = schemaFrom(this.dataSource.options);
    const stats = await this.dataSource.query(
      `SELECT t."id",(t."estado"='PUBLICADO' AND NOT EXISTS (SELECT 1 FROM ${schema}."asignacion_tema" a WHERE a."tema_id"=t."id" AND a."estado"='VIGENTE')) AS disponible,(SELECT count(*)::int FROM ${schema}."postulacion" p WHERE p."tema_id"=t."id" AND ($1::uuid IS NULL OR p."periodo_id"=$1) AND p."estado" IN ('PENDIENTE','EN_CONFLICTO')) AS postulaciones_abiertas FROM ${schema}."tema" t WHERE t."id"=ANY($2::uuid[])`,
      [periodoId, ids],
    ) as Array<{ id: string; disponible: boolean; postulaciones_abiertas: number }>;
    const byId = new Map(stats.map((row) => [row.id, row]));
    return responses.map((item) => ({ ...item, disponible: byId.get(item.id)?.disponible ?? false, postulaciones_abiertas: Number(byId.get(item.id)?.postulaciones_abiertas ?? 0) }));
  }

  private async writeHistory(manager: EntityManager, tema: Tema, actor: Usuario, previous: Record<string, unknown> | null, motivo?: string): Promise<void> {
    const repository = manager.getRepository(TemaHistorial);
    await repository.save(repository.create({
      tema, usuario: actor, estado_anterior: previous ? previous.estado as EstadoTema : null, estado_nuevo: tema.estado,
      cambios: { anteriores: previous, nuevos: temaValues(tema), ...(motivo ? { motivo } : {}) }, fecha: new Date(),
    }));
  }

  private handleDatabaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (hasCode(error, '23503')) throw new ConflictException('Una referencia relacionada no es compatible con el tema.');
    if (hasCode(error, '23514')) throw new BadRequestException('Los datos incumplen una regla de tema.');
    if (hasCode(error, '40001') || hasCode(error, '40P01')) throw new ConflictException('La operación coincidió con otro cambio simultáneo. Vuelve a intentarlo.');
    throw new ServiceUnavailableException('No se pudo completar la operación de temas en PostgreSQL.', { cause: error });
  }
}
