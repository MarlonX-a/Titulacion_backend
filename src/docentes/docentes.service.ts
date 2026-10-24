import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { UsuarioResumenDto } from '../common/dto/usuario-resumen.dto.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CreateDocenteDto } from './dto/create-docente.dto.js';
import { DocenteResponseDto } from './dto/docente-response.dto.js';
import { Docente } from './entities/docente.entity.js';

interface PostgresDriverError {
  code?: string;
}

export interface PagedDocentes {
  data: DocenteResponseDto[];
  total: number;
  page: number;
  limit: number;
}

function responseFrom(docente: Docente): DocenteResponseDto {
  const usuario: UsuarioResumenDto = {
    id: docente.usuario.id,
    email: docente.usuario.email,
    nombres: docente.usuario.nombres,
    apellidos: docente.usuario.apellidos,
    rol: docente.usuario.rol,
    estado: docente.usuario.estado,
  };
  return {
    id: docente.id,
    usuario,
    cedula: docente.cedula,
    titulo_academico: docente.titulo_academico,
    departamento: docente.departamento,
    habilitado_tutoria: docente.habilitado_tutoria,
  };
}

function isDatabaseConflict(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as PostgresDriverError;
  return driverError.code === '23505' || driverError.code === '23503';
}

@Injectable()
export class DocentesService {
  constructor(
    @InjectRepository(Docente)
    private readonly repository: Repository<Docente>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateDocenteDto): Promise<DocenteResponseDto> {
    try {
      const docente = await this.dataSource.transaction(async (manager) => {
        const usuarios = manager.getRepository(Usuario);
        const usuario = await usuarios.findOne({
          where: { id: dto.usuario_id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!usuario) {
          throw new NotFoundException('No existe la cuenta indicada.');
        }
        if (
          usuario.estado !== UsuarioEstado.ACTIVO ||
          usuario.rol !== UsuarioRol.DOCENTE
        ) {
          throw new ConflictException(
            'La cuenta debe estar activa y tener rol DOCENTE.',
          );
        }

        const docentes = manager.getRepository(Docente);
        return docentes.save(
          docentes.create({
            usuario,
            cedula: dto.cedula.trim(),
            titulo_academico: dto.titulo_academico.trim(),
            departamento: dto.departamento.trim(),
            habilitado_tutoria: dto.habilitado_tutoria ?? false,
          }),
        );
      });
      return responseFrom(docente);
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  async list(query: PaginationQueryDto): Promise<PagedDocentes> {
    try {
      const [docentes, total] = await this.repository.findAndCount({
        relations: { usuario: true },
        order: { id: 'ASC' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      return {
        data: docentes.map(responseFrom),
        total,
        page: query.page,
        limit: query.limit,
      };
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  async getById(id: string): Promise<DocenteResponseDto> {
    try {
      const docente = await this.repository.findOne({
        where: { id },
        relations: { usuario: true },
      });
      if (!docente) {
        throw new NotFoundException('No existe el perfil de docente solicitado.');
      }
      return responseFrom(docente);
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  async getByUsuarioId(usuarioId: string): Promise<DocenteResponseDto> {
    try {
      const docente = await this.repository.findOne({
        where: { usuario: { id: usuarioId } },
        relations: { usuario: true },
      });
      if (!docente) {
        throw new NotFoundException('La cuenta aún no tiene perfil de docente.');
      }
      return responseFrom(docente);
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  private handleDatabaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (isDatabaseConflict(error)) {
      throw new ConflictException(
        'La cuenta o cédula ya está vinculada a otro perfil.',
      );
    }
    throw new ServiceUnavailableException(
      'No se pudo completar la operación de docentes en PostgreSQL.',
    );
  }
}
