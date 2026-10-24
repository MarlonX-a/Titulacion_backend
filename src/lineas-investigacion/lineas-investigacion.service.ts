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
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CreateLineaInvestigacionDto } from './dto/create-linea-investigacion.dto.js';
import { LineaInvestigacionResponseDto } from './dto/linea-investigacion-response.dto.js';
import { ListLineasQueryDto } from './dto/list-lineas-query.dto.js';
import { UpdateLineaInvestigacionDto } from './dto/update-linea-investigacion.dto.js';
import { LineaInvestigacion } from './entities/linea-investigacion.entity.js';

interface PostgresDriverError { code?: string; }

export interface PagedLineas {
  data: LineaInvestigacionResponseDto[];
  total: number;
  page: number;
  limit: number;
}

function responseFrom(linea: LineaInvestigacion): LineaInvestigacionResponseDto {
  return { id: linea.id, codigo: linea.codigo, nombre: linea.nombre, descripcion: linea.descripcion, activa: linea.activa };
}

function hasCode(error: unknown, expected: string): boolean {
  return error instanceof QueryFailedError && (error.driverError as PostgresDriverError).code === expected;
}

@Injectable()
export class LineasInvestigacionService {
  constructor(
    @InjectRepository(LineaInvestigacion)
    private readonly repository: Repository<LineaInvestigacion>,
    private readonly dataSource: DataSource,
    private readonly auditoria: AuditoriaService,
  ) {}

  async create(dto: CreateLineaInvestigacionDto, actor: Usuario, ip: string | null): Promise<LineaInvestigacionResponseDto> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(LineaInvestigacion);
        const linea = await repo.save(repo.create({
          codigo: dto.codigo.trim(), nombre: dto.nombre.trim(),
          descripcion: dto.descripcion === undefined ? null : dto.descripcion.trim(), activa: true,
        }));
        const values = responseFrom(linea);
        await this.auditoria.registrar(manager, {
          actor, accion: 'CREAR_LINEA_INVESTIGACION', entidad_tipo: 'linea_investigacion', entidad_id: linea.id,
          valores_anteriores: null, valores_nuevos: { ...values }, ip_origen: ip,
        });
        return values;
      });
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async list(query: ListLineasQueryDto, role: UsuarioRol): Promise<PagedLineas> {
    if (role !== UsuarioRol.ADMIN && query.activa === false) {
      throw new ForbiddenException('Solo ADMIN puede consultar líneas inactivas.');
    }
    try {
      const activeFilter = role === UsuarioRol.ADMIN ? query.activa : true;
      const [records, total] = await this.repository.findAndCount({
        where: activeFilter === undefined ? {} : { activa: activeFilter },
        order: { codigo: 'ASC', id: 'ASC' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      return { data: records.map(responseFrom), total, page: query.page, limit: query.limit };
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async getById(id: string, role: UsuarioRol): Promise<LineaInvestigacionResponseDto> {
    try {
      const linea = await this.repository.findOne({
        where: role === UsuarioRol.ADMIN ? { id } : { id, activa: true },
      });
      if (!linea) throw new NotFoundException('No existe la línea de investigación solicitada.');
      return responseFrom(linea);
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async update(id: string, dto: UpdateLineaInvestigacionDto, actor: Usuario, ip: string | null): Promise<LineaInvestigacionResponseDto> {
    if (!Object.values(dto).some((value) => value !== undefined)) {
      throw new BadRequestException('Debe indicar al menos un campo para editar.');
    }
    try {
      return await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(LineaInvestigacion);
        const linea = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
        if (!linea) throw new NotFoundException('No existe la línea de investigación solicitada.');
        const previous = responseFrom(linea);
        if (dto.codigo !== undefined) linea.codigo = dto.codigo.trim();
        if (dto.nombre !== undefined) linea.nombre = dto.nombre.trim();
        if (dto.descripcion !== undefined) linea.descripcion = dto.descripcion === null ? null : dto.descripcion.trim();
        if (dto.activa !== undefined) linea.activa = dto.activa;
        const next = responseFrom(linea);
        if (Object.keys(next).every((key) => next[key as keyof typeof next] === previous[key as keyof typeof previous])) return previous;
        const updated = await repo.save(linea);
        const values = responseFrom(updated);
        await this.auditoria.registrar(manager, {
          actor, accion: 'ACTUALIZAR_LINEA_INVESTIGACION', entidad_tipo: 'linea_investigacion', entidad_id: id,
          valores_anteriores: { ...previous }, valores_nuevos: { ...values }, ip_origen: ip,
        });
        return values;
      });
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  private handleDatabaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (hasCode(error, '23505')) throw new ConflictException('Ya existe una línea de investigación con ese código.');
    if (hasCode(error, '23514')) throw new BadRequestException('Los datos incumplen una regla de línea de investigación.');
    throw new ServiceUnavailableException('No se pudo completar la operación de líneas de investigación en PostgreSQL.', { cause: error });
  }
}
