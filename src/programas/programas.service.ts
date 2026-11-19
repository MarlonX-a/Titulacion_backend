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
import { DataSource, EntityManager, QueryFailedError, Repository, type FindOptionsWhere } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { AcademicoService } from '../academico/academico.service.js';
import { resumenCatalogo, type CatalogoAcademico } from '../academico/catalogo-academico.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CreateProgramaDto, ListProgramasQueryDto, MAX_TEMAS_PROGRAMA_DEFECTO, type PagedProgramasResponseDto, ProgramaResponseDto, UpdateProgramaDto } from './dto/programa.dto.js';
import { Programa } from './entities/programa.entity.js';

interface DriverError { code?: string; constraint?: string }

const relaciones = { responsable_docente: { usuario: true }, responsable_usuario: true } as const;

function valores(programa: Programa): Record<string, unknown> {
  return {
    nombre: programa.nombre, descripcion: programa.descripcion, carrera_id: programa.carrera_id,
    responsable_docente_id: programa.responsable_docente_id, responsable_usuario_id: programa.responsable_usuario_id,
    max_temas: programa.max_temas, activo: programa.activo,
  };
}

/**
 * Programas de temas (bloque 4). ADMIN gestiona todos; COORDINADOR crea programas bajo su propia
 * responsabilidad y edita solo los suyos. DOCENTE y COORDINADOR leen todos; ESTUDIANTE solo los
 * activos de su carrera. No hay borrado físico: se desactiva con `activo=false`.
 */
@Injectable()
export class ProgramasService {
  constructor(
    @InjectRepository(Programa) private readonly repository: Repository<Programa>,
    private readonly dataSource: DataSource,
    private readonly auditoria: AuditoriaService,
    private readonly academico: AcademicoService = new AcademicoService(),
  ) {}

  async list(query: ListProgramasQueryDto, actor: Usuario): Promise<PagedProgramasResponseDto> {
    try {
      const where: FindOptionsWhere<Programa> = {
        ...(query.carrera_id ? { carrera_id: query.carrera_id } : {}),
        ...(query.facultad_id ? { carrera: { facultad_id: query.facultad_id } } : {}),
        ...(query.responsable_docente_id ? { responsable_docente_id: query.responsable_docente_id } : {}),
        ...(query.responsable_usuario_id ? { responsable_usuario_id: query.responsable_usuario_id } : {}),
        ...(query.activo !== undefined ? { activo: query.activo } : {}),
      };
      if (actor.rol === UsuarioRol.ESTUDIANTE) {
        const carreraId = await this.carreraDeEstudiante(actor);
        if (!carreraId) return { data: [], total: 0, page: query.page, limit: query.limit };
        if (query.carrera_id && query.carrera_id !== carreraId) return { data: [], total: 0, page: query.page, limit: query.limit };
        where.carrera_id = carreraId;
        where.activo = true;
      } else if (query.mios === true) {
        if (actor.rol === UsuarioRol.COORDINADOR) where.responsable_usuario_id = actor.id;
        if (actor.rol === UsuarioRol.DOCENTE) {
          const docente = await this.dataSource.getRepository(Docente).findOne({ where: { usuario: { id: actor.id } } });
          if (!docente) return { data: [], total: 0, page: query.page, limit: query.limit };
          where.responsable_docente_id = docente.id;
        }
      }
      const [registros, total] = await this.repository.findAndCount({
        where, relations: relaciones, order: { nombre: 'ASC', id: 'ASC' },
        skip: (query.page - 1) * query.limit, take: query.limit,
      });
      return { data: await this.respuestas(registros), total, page: query.page, limit: query.limit };
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async getById(id: string, actor: Usuario): Promise<ProgramaResponseDto> {
    try {
      const programa = await this.repository.findOne({ where: { id }, relations: relaciones });
      if (!programa) throw new NotFoundException('No existe el programa indicado.');
      if (actor.rol === UsuarioRol.ESTUDIANTE) {
        const carreraId = await this.carreraDeEstudiante(actor);
        if (!programa.activo || programa.carrera_id !== carreraId) throw new NotFoundException('No existe el programa indicado.');
      }
      return (await this.respuestas([programa]))[0]!;
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async create(dto: CreateProgramaDto, actor: Usuario, ip: string | null): Promise<ProgramaResponseDto> {
    let docenteId = dto.responsable_docente_id ?? null;
    let usuarioId = dto.responsable_usuario_id ?? null;
    if (actor.rol === UsuarioRol.COORDINADOR) {
      if (docenteId || (usuarioId && usuarioId !== actor.id)) {
        throw new ForbiddenException('Un COORDINADOR solo puede crear programas bajo su propia responsabilidad.');
      }
      usuarioId = actor.id;
      docenteId = null;
    }
    if ((docenteId === null) === (usuarioId === null)) {
      throw new BadRequestException('Indica exactamente un responsable: responsable_docente_id o responsable_usuario_id.');
    }
    try {
      const id = await this.dataSource.transaction(async (manager) => {
        await this.academico.buscarCarrera(this.dataSource, dto.carrera_id);
        await this.validarResponsable(manager, dto.carrera_id, docenteId, usuarioId);
        const repo = manager.getRepository(Programa);
        const programa = await repo.save(repo.create({
          nombre: dto.nombre.trim(), descripcion: dto.descripcion?.trim() || null, carrera_id: dto.carrera_id,
          responsable_docente_id: docenteId, responsable_usuario_id: usuarioId,
          max_temas: dto.max_temas ?? MAX_TEMAS_PROGRAMA_DEFECTO, activo: true,
        }));
        await this.auditoria.registrar(manager, { actor, accion: 'CREAR_PROGRAMA', entidad_tipo: 'programa', entidad_id: programa.id, valores_anteriores: null, valores_nuevos: valores(programa), ip_origen: ip });
        return programa.id;
      });
      return await this.getById(id, actor);
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async update(id: string, dto: UpdateProgramaDto, actor: Usuario, ip: string | null): Promise<ProgramaResponseDto> {
    if (!Object.values(dto).some((value) => value !== undefined)) throw new BadRequestException('Debe indicar al menos un campo para editar.');
    if (dto.responsable_docente_id !== undefined && dto.responsable_usuario_id !== undefined) {
      throw new BadRequestException('Indica un solo responsable: responsable_docente_id o responsable_usuario_id.');
    }
    try {
      await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(Programa);
        const programa = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
        if (!programa) throw new NotFoundException('No existe el programa indicado.');
        if (actor.rol === UsuarioRol.COORDINADOR) {
          if (programa.responsable_usuario_id !== actor.id) throw new ForbiddenException('Solo puedes editar programas de los que eres responsable.');
          if (dto.responsable_docente_id !== undefined || dto.responsable_usuario_id !== undefined) throw new ForbiddenException('Solo ADMIN puede cambiar el responsable de un programa.');
        }
        const anterior = valores(programa);
        const temas = await this.temasRegistrados(manager, [programa.id]);
        const actuales = temas.get(programa.id) ?? 0;
        if (dto.carrera_id !== undefined && dto.carrera_id !== programa.carrera_id) {
          await this.academico.buscarCarrera(this.dataSource, dto.carrera_id);
          if (await this.tieneTemas(manager, programa.id)) throw new ConflictException('No se puede cambiar la carrera de un programa que ya tiene temas.');
          programa.carrera_id = dto.carrera_id;
        }
        if (dto.responsable_docente_id !== undefined) { programa.responsable_docente_id = dto.responsable_docente_id; programa.responsable_usuario_id = null; }
        if (dto.responsable_usuario_id !== undefined) { programa.responsable_usuario_id = dto.responsable_usuario_id; programa.responsable_docente_id = null; }
        if (dto.carrera_id !== undefined || dto.responsable_docente_id !== undefined || dto.responsable_usuario_id !== undefined) {
          await this.validarResponsable(manager, programa.carrera_id, programa.responsable_docente_id, programa.responsable_usuario_id);
        }
        if (dto.max_temas !== undefined) {
          if (dto.max_temas < actuales) throw new ConflictException(`El programa tiene ${actuales} temas; el máximo no puede ser menor.`);
          programa.max_temas = dto.max_temas;
        }
        if (dto.nombre !== undefined) programa.nombre = dto.nombre.trim();
        if (dto.descripcion !== undefined) programa.descripcion = dto.descripcion?.trim() || null;
        if (dto.activo !== undefined) programa.activo = dto.activo;
        if (JSON.stringify(anterior) === JSON.stringify(valores(programa))) return;
        programa.actualizado_en = new Date();
        await repo.save(programa);
        await this.auditoria.registrar(manager, { actor, accion: 'ACTUALIZAR_PROGRAMA', entidad_tipo: 'programa', entidad_id: programa.id, valores_anteriores: anterior, valores_nuevos: valores(programa), ip_origen: ip });
      });
      return await this.getById(id, actor);
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  /**
   * Regla de servicio al asignar un tema a un programa (el disparador TRG_tema_programa la repite):
   * programa existente y activo, de la misma carrera y con cupo. Bloquea la fila del programa para
   * serializar altas concurrentes. Un COORDINADOR solo puede usar programas de los que es responsable.
   */
  async validarParaTema(manager: EntityManager, programaId: string, carreraId: string, actor: Usuario, temaId: string | null): Promise<Programa> {
    const programa = await manager.getRepository(Programa).findOne({ where: { id: programaId }, lock: { mode: 'pessimistic_write' } });
    if (!programa) throw new NotFoundException('No existe el programa indicado.');
    if (actor.rol === UsuarioRol.COORDINADOR && programa.responsable_usuario_id !== actor.id) {
      throw new ForbiddenException('Solo puedes registrar temas en programas de los que eres responsable.');
    }
    if (!programa.activo) throw new ConflictException('El programa está inactivo.');
    if (programa.carrera_id !== carreraId) throw new ConflictException('La carrera del tema debe coincidir con la del programa.');
    const s = this.schema(manager);
    const rows = await manager.query(
      `SELECT count(*)::int AS total FROM ${s}."tema" WHERE "programa_id"=$1 AND "estado"<>'RETIRADO' AND ($2::uuid IS NULL OR "id"<>$2)`,
      [programaId, temaId],
    ) as Array<{ total: number }>;
    if (Number(rows[0]?.total ?? 0) + 1 > programa.max_temas) throw new ConflictException(`El programa alcanzó su máximo de ${programa.max_temas} temas.`);
    return programa;
  }

  /** Un COORDINADOR solo gestiona temas de programas de los que es responsable. */
  async assertCoordinadorDelPrograma(manager: EntityManager, programaId: string | null, actor: Usuario): Promise<void> {
    if (actor.rol !== UsuarioRol.COORDINADOR) return;
    const programa = programaId ? await manager.getRepository(Programa).findOne({ where: { id: programaId } }) : null;
    if (!programa || programa.responsable_usuario_id !== actor.id) throw new ForbiddenException('Solo puedes gestionar temas de los programas de los que eres responsable.');
  }

  private async validarResponsable(manager: EntityManager, carreraId: string, docenteId: string | null, usuarioId: string | null): Promise<void> {
    if (docenteId) {
      const docente = await manager.getRepository(Docente).findOne({ where: { id: docenteId }, relations: { usuario: true } });
      if (!docente) throw new NotFoundException('No existe el docente responsable indicado.');
      if (docente.usuario.estado !== UsuarioEstado.ACTIVO) throw new ConflictException('El docente responsable debe tener una cuenta activa.');
      if (docente.carrera_id !== carreraId) throw new ConflictException('El docente responsable debe pertenecer a la carrera del programa.');
    }
    if (usuarioId) {
      const usuario = await manager.getRepository(Usuario).findOne({ where: { id: usuarioId }, lock: { mode: 'pessimistic_read' } });
      if (!usuario) throw new NotFoundException('No existe el usuario responsable indicado.');
      if (usuario.rol !== UsuarioRol.COORDINADOR || usuario.estado !== UsuarioEstado.ACTIVO) throw new ConflictException('El responsable debe ser una cuenta COORDINADOR activa.');
    }
  }

  private async respuestas(programas: Programa[]): Promise<ProgramaResponseDto[]> {
    if (!programas.length) return [];
    const catalogo = await this.academico.catalogo(this.dataSource);
    const temas = await this.temasRegistrados(this.dataSource.manager, programas.map((p) => p.id));
    return programas.map((programa) => this.respuesta(programa, catalogo, temas.get(programa.id) ?? 0));
  }

  private respuesta(programa: Programa, catalogo: CatalogoAcademico, temasRegistrados: number): ProgramaResponseDto {
    const docente = programa.responsable_docente;
    const usuario = programa.responsable_usuario;
    const responsable = docente
      ? { tipo: 'DOCENTE' as const, id: docente.id, nombres: docente.usuario.nombres, apellidos: docente.usuario.apellidos }
      : { tipo: 'COORDINADOR' as const, id: programa.responsable_usuario_id ?? '', nombres: usuario?.nombres ?? '', apellidos: usuario?.apellidos ?? '' };
    return {
      id: programa.id, nombre: programa.nombre, descripcion: programa.descripcion,
      carrera_id: programa.carrera_id, carrera: resumenCatalogo(catalogo.carrera(programa.carrera_id), programa.carrera_id),
      responsable_docente_id: programa.responsable_docente_id, responsable_usuario_id: programa.responsable_usuario_id, responsable,
      max_temas: programa.max_temas, temas_registrados: temasRegistrados, activo: programa.activo,
      creado_en: programa.creado_en, actualizado_en: programa.actualizado_en,
    };
  }

  private async temasRegistrados(manager: EntityManager, ids: string[]): Promise<Map<string, number>> {
    const rows = await manager.query(
      `SELECT "programa_id", count(*)::int AS total FROM ${this.schema(manager)}."tema" WHERE "programa_id" = ANY($1::uuid[]) AND "estado"<>'RETIRADO' GROUP BY "programa_id"`,
      [ids],
    ) as Array<{ programa_id: string; total: number }>;
    return new Map(rows.map((row) => [row.programa_id, Number(row.total)]));
  }

  private async tieneTemas(manager: EntityManager, id: string): Promise<boolean> {
    const rows = await manager.query(`SELECT 1 FROM ${this.schema(manager)}."tema" WHERE "programa_id"=$1 LIMIT 1`, [id]) as unknown[];
    return rows.length > 0;
  }

  private async carreraDeEstudiante(actor: Usuario): Promise<string | null> {
    const estudiante = await this.dataSource.getRepository(Estudiante).findOne({ where: { usuario: { id: actor.id } } });
    return estudiante?.carrera_id ?? null;
  }

  private schema(manager: EntityManager): string {
    const schema = (manager.connection.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new ServiceUnavailableException('El esquema PostgreSQL configurado no es válido.');
    return `"${schema}"`;
  }

  private handleDatabaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (error instanceof QueryFailedError) {
      const driver = error.driverError as DriverError;
      if (driver.code === '23505' && driver.constraint === 'UQ_programa_carrera_nombre') throw new ConflictException('Ya existe un programa con ese nombre en la carrera.');
      if (driver.code === '23514') throw new ConflictException('Los datos incumplen una regla del programa.');
      if (driver.code === '23503') throw new ConflictException('Una referencia del programa no es válida.');
      if (driver.code === '40001' || driver.code === '40P01') throw new ConflictException('La operación coincidió con otro cambio simultáneo. Vuelve a intentarlo.');
    }
    throw new ServiceUnavailableException('No se pudo completar la operación de programas en PostgreSQL.', { cause: error });
  }
}
