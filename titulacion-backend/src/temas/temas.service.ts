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
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { LineaInvestigacion } from '../lineas-investigacion/entities/linea-investigacion.entity.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CreateTemaDto } from './dto/create-tema.dto.js';
import { ListTemasQueryDto } from './dto/list-temas-query.dto.js';
import { TemaHistorialResponseDto } from './dto/tema-historial-response.dto.js';
import { TemaResponseDto } from './dto/tema-response.dto.js';
import { UpdateTemaDto } from './dto/update-tema.dto.js';
import { TemaHistorial } from './entities/tema-historial.entity.js';
import { Tema } from './entities/tema.entity.js';
import { EstadoTema } from './enums/estado-tema.enum.js';

interface PostgresDriverError { code?: string; }
export interface PagedTemas { data: TemaResponseDto[]; total: number; page: number; limit: number; }
export interface PagedTemaHistorial { data: TemaHistorialResponseDto[]; total: number; page: number; limit: number; }

function hasCode(error: unknown, code: string): boolean {
  return error instanceof QueryFailedError && (error.driverError as PostgresDriverError).code === code;
}

function temaValues(tema: Tema): Record<string, unknown> {
  return {
    periodo_id: tema.periodo.id,
    linea_id: tema.linea.id,
    docente_proponente_id: tema.docente_proponente.id,
    titulo: tema.titulo,
    descripcion: tema.descripcion,
    min_integrantes: tema.min_integrantes,
    max_integrantes: tema.max_integrantes,
    estado: tema.estado,
    creado_en: tema.creado_en,
  };
}

function responseFrom(tema: Tema): TemaResponseDto {
  return {
    id: tema.id,
    periodo_id: tema.periodo.id,
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
    min_integrantes: tema.min_integrantes,
    max_integrantes: tema.max_integrantes,
    estado: tema.estado,
    creado_en: tema.creado_en,
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

const temaRelations = { periodo: true, linea: true, docente_proponente: { usuario: true } } as const;

@Injectable()
export class TemasService {
  constructor(
    @InjectRepository(Tema) private readonly repository: Repository<Tema>,
    @InjectRepository(TemaHistorial) private readonly historialRepository: Repository<TemaHistorial>,
    @InjectRepository(Docente) private readonly docenteRepository: Repository<Docente>,
    private readonly dataSource: DataSource,
    private readonly auditoria: AuditoriaService,
  ) {}

  async create(periodoId: string, dto: CreateTemaDto, actor: Usuario, ip: string | null): Promise<TemaResponseDto> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const periodo = await this.lockDraftPeriod(manager, periodoId);
        const refs = await this.references(manager, dto.linea_id, dto.docente_proponente_id);
        this.assertRange(dto.min_integrantes, dto.max_integrantes);
        const repo = manager.getRepository(Tema);
        const tema = await repo.save(repo.create({
          periodo, linea: refs.linea, docente_proponente: refs.docente,
          titulo: dto.titulo.trim(), descripcion: dto.descripcion.trim(),
          min_integrantes: dto.min_integrantes, max_integrantes: dto.max_integrantes,
          estado: EstadoTema.BORRADOR,
        }));
        const loaded = await this.loadForResponse(manager, tema.id, periodoId);
        await this.writeHistory(manager, loaded, actor, null);
        await this.auditoria.registrar(manager, {
          actor, accion: 'CREAR_TEMA', entidad_tipo: 'tema', entidad_id: loaded.id,
          valores_anteriores: null, valores_nuevos: temaValues(loaded), ip_origen: ip,
        });
        return responseFrom(loaded);
      });
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async list(periodoId: string, query: ListTemasQueryDto, actor: Usuario): Promise<PagedTemas> {
    try {
      let docenteId = query.docente_proponente_id;
      if (actor.rol === UsuarioRol.DOCENTE) {
        const docente = await this.docenteRepository.findOne({ where: { usuario: { id: actor.id } } });
        if (!docente) throw new NotFoundException('La cuenta aún no tiene perfil de docente.');
        if (docenteId && docenteId !== docente.id) throw new ForbiddenException('Solo puedes consultar tus temas propuestos.');
        docenteId = docente.id;
      }
      const [records, total] = await this.repository.findAndCount({
        where: {
          periodo: { id: periodoId },
          ...(query.linea_id ? { linea: { id: query.linea_id } } : {}),
          ...(docenteId ? { docente_proponente: { id: docenteId } } : {}),
          ...(query.estado ? { estado: query.estado } : {}),
        },
        relations: temaRelations,
        order: { creado_en: 'DESC', id: 'ASC' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      return { data: records.map(responseFrom), total, page: query.page, limit: query.limit };
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async getById(periodoId: string, id: string, actor: Usuario): Promise<TemaResponseDto> {
    try {
      const tema = await this.repository.findOne({ where: { id, periodo: { id: periodoId } }, relations: temaRelations });
      if (!tema) throw new NotFoundException('No existe el tema en el período indicado.');
      if (actor.rol === UsuarioRol.DOCENTE) {
        const docente = await this.docenteRepository.findOne({ where: { usuario: { id: actor.id } } });
        if (!docente) throw new NotFoundException('La cuenta aún no tiene perfil de docente.');
        if (tema.docente_proponente.id !== docente.id) throw new NotFoundException('No existe el tema en el período indicado.');
      }
      return responseFrom(tema);
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async update(periodoId: string, id: string, dto: UpdateTemaDto, actor: Usuario, ip: string | null): Promise<TemaResponseDto> {
    if (!Object.values(dto).some((value) => value !== undefined)) throw new BadRequestException('Debe indicar al menos un campo para editar.');
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.lockDraftPeriod(manager, periodoId);
        const repo = manager.getRepository(Tema);
        const locked = await repo.findOne({ where: { id, periodo: { id: periodoId } }, lock: { mode: 'pessimistic_write' } });
        if (!locked) throw new NotFoundException('No existe el tema en el período indicado.');
        const tema = await repo.findOne({ where: { id: locked.id }, relations: temaRelations });
        if (!tema) throw new NotFoundException('No existe el tema en el período indicado.');
        if (tema.estado !== EstadoTema.BORRADOR) throw new ConflictException('Solo se pueden editar temas en estado BORRADOR.');
        const previous = temaValues(tema);
        if (dto.linea_id !== undefined) tema.linea = (await this.references(manager, dto.linea_id, tema.docente_proponente.id)).linea;
        if (dto.docente_proponente_id !== undefined) tema.docente_proponente = (await this.references(manager, tema.linea.id, dto.docente_proponente_id)).docente;
        if (dto.titulo !== undefined) tema.titulo = dto.titulo.trim();
        if (dto.descripcion !== undefined) tema.descripcion = dto.descripcion.trim();
        if (dto.min_integrantes !== undefined) tema.min_integrantes = dto.min_integrantes;
        if (dto.max_integrantes !== undefined) tema.max_integrantes = dto.max_integrantes;
        this.assertRange(tema.min_integrantes, tema.max_integrantes);
        const next = temaValues(tema);
        if (JSON.stringify(previous) === JSON.stringify(next)) return responseFrom(tema);
        await repo.save(tema);
        const loaded = await this.loadForResponse(manager, id, periodoId);
        await this.writeHistory(manager, loaded, actor, previous);
        await this.auditoria.registrar(manager, {
          actor, accion: 'ACTUALIZAR_TEMA', entidad_tipo: 'tema', entidad_id: id,
          valores_anteriores: previous, valores_nuevos: temaValues(loaded), ip_origen: ip,
        });
        return responseFrom(loaded);
      });
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async history(periodoId: string, id: string, query: ListTemasQueryDto): Promise<PagedTemaHistorial> {
    try {
      const tema = await this.repository.findOneBy({ id, periodo: { id: periodoId } });
      if (!tema) throw new NotFoundException('No existe el tema en el período indicado.');
      const [records, total] = await this.historialRepository.findAndCount({
        where: { tema: { id } }, relations: { tema: true, usuario: true }, order: { fecha: 'ASC', id: 'ASC' },
        skip: (query.page - 1) * query.limit, take: query.limit,
      });
      return { data: records.map(historialResponseFrom), total, page: query.page, limit: query.limit };
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  private async lockDraftPeriod(manager: EntityManager, id: string): Promise<PeriodoTitulacion> {
    const period = await manager.getRepository(PeriodoTitulacion).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!period) throw new NotFoundException('No existe el período indicado.');
    if (period.estado !== PeriodoEstado.BORRADOR) throw new ConflictException('Los temas solo se administran en períodos BORRADOR.');
    return period;
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
    return { linea, docente };
  }

  private async loadForResponse(manager: EntityManager, id: string, periodoId: string): Promise<Tema> {
    const record = await manager.getRepository(Tema).findOne({ where: { id, periodo: { id: periodoId } }, relations: temaRelations });
    if (!record) throw new NotFoundException('No existe el tema en el período indicado.');
    return record;
  }

  private async writeHistory(manager: EntityManager, tema: Tema, actor: Usuario, previous: Record<string, unknown> | null): Promise<void> {
    const repository = manager.getRepository(TemaHistorial);
    await repository.save(repository.create({
      tema, usuario: actor, estado_anterior: previous ? tema.estado : null, estado_nuevo: tema.estado,
      cambios: { anteriores: previous, nuevos: temaValues(tema) }, fecha: new Date(),
    }));
  }

  private assertRange(min: number, max: number): void {
    if (max < min) throw new BadRequestException('El máximo de integrantes debe ser igual o mayor que el mínimo.');
  }

  private handleDatabaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (hasCode(error, '23503')) throw new ConflictException('Una referencia relacionada no es compatible con el tema.');
    if (hasCode(error, '23514')) throw new BadRequestException('Los datos incumplen una regla de tema.');
    throw new ServiceUnavailableException('No se pudo completar la operación de temas en PostgreSQL.', { cause: error });
  }
}
