import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { UsuarioResumenDto } from '../common/dto/usuario-resumen.dto.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CreateEstudianteDto } from './dto/create-estudiante.dto.js';
import { EstudianteResponseDto } from './dto/estudiante-response.dto.js';
import { Estudiante } from './entities/estudiante.entity.js';

interface PostgresDriverError {
  code?: string;
}

export interface PagedEstudiantes {
  data: EstudianteResponseDto[];
  total: number;
  page: number;
  limit: number;
}

function responseFrom(estudiante: Estudiante): EstudianteResponseDto {
  const usuario: UsuarioResumenDto = {
    id: estudiante.usuario.id,
    email: estudiante.usuario.email,
    nombres: estudiante.usuario.nombres,
    apellidos: estudiante.usuario.apellidos,
    rol: estudiante.usuario.rol,
    estado: estudiante.usuario.estado,
  };
  return {
    id: estudiante.id,
    usuario,
    cedula: estudiante.cedula,
    matricula: estudiante.matricula,
    carrera: estudiante.carrera,
    nivel: estudiante.nivel,
  };
}

function isDatabaseConflict(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as PostgresDriverError;
  return driverError.code === '23505' || driverError.code === '23503';
}

@Injectable()
export class EstudiantesService {
  constructor(
    @InjectRepository(Estudiante)
    private readonly repository: Repository<Estudiante>,
    private readonly dataSource: DataSource,
  ) {}

  async getActiveProfileForHabilitacion(
    estudianteId: string,
    manager: EntityManager,
  ): Promise<Estudiante> {
    const options = manager.connection.options as PostgresConnectionOptions;
    const schema = options.schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) {
      throw new ServiceUnavailableException('El esquema PostgreSQL configurado no es válido.');
    }
    const rows = (await manager.query(
      `SELECT "usuario_id" FROM "${schema}"."estudiante" WHERE "id" = $1 FOR UPDATE`,
      [estudianteId],
    )) as Array<{ usuario_id: string }>;
    const usuarioId = rows[0]?.usuario_id;
    if (!usuarioId) {
      throw new NotFoundException('No existe el perfil de estudiante indicado.');
    }
    const usuario = await manager.getRepository(Usuario).findOne({
      where: { id: usuarioId },
      lock: { mode: 'pessimistic_write' },
    });
    const estudiante = await manager.getRepository(Estudiante).findOne({
      where: { id: estudianteId },
      relations: { usuario: true },
    });
    if (!usuario || !estudiante) {
      throw new NotFoundException('No existe el perfil de estudiante indicado.');
    }
    if (
      usuario.estado !== UsuarioEstado.ACTIVO ||
      usuario.rol !== UsuarioRol.ESTUDIANTE
    ) {
      throw new ConflictException(
        'El perfil debe pertenecer a una cuenta activa con rol ESTUDIANTE.',
      );
    }
    return estudiante;
  }

  async create(dto: CreateEstudianteDto): Promise<EstudianteResponseDto> {
    try {
      const estudiante = await this.dataSource.transaction(async (manager) => {
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
          usuario.rol !== UsuarioRol.ESTUDIANTE
        ) {
          throw new ConflictException(
            'La cuenta debe estar activa y tener rol ESTUDIANTE.',
          );
        }

        const estudiantes = manager.getRepository(Estudiante);
        return estudiantes.save(
          estudiantes.create({
            usuario,
            cedula: dto.cedula.trim(),
            matricula: dto.matricula.trim(),
            carrera: dto.carrera.trim(),
            nivel: dto.nivel,
          }),
        );
      });
      return responseFrom(estudiante);
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  async list(query: PaginationQueryDto): Promise<PagedEstudiantes> {
    try {
      const [estudiantes, total] = await this.repository.findAndCount({
        relations: { usuario: true },
        order: { id: 'ASC' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      return {
        data: estudiantes.map(responseFrom),
        total,
        page: query.page,
        limit: query.limit,
      };
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  async getById(id: string): Promise<EstudianteResponseDto> {
    try {
      const estudiante = await this.repository.findOne({
        where: { id },
        relations: { usuario: true },
      });
      if (!estudiante) {
        throw new NotFoundException('No existe el perfil de estudiante solicitado.');
      }
      return responseFrom(estudiante);
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  async getByUsuarioId(usuarioId: string): Promise<EstudianteResponseDto> {
    try {
      const estudiante = await this.repository.findOne({
        where: { usuario: { id: usuarioId } },
        relations: { usuario: true },
      });
      if (!estudiante) {
        throw new NotFoundException('La cuenta aún no tiene perfil de estudiante.');
      }
      return responseFrom(estudiante);
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  private handleDatabaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (isDatabaseConflict(error)) {
      throw new ConflictException(
        'La cuenta, cédula o matrícula ya está vinculada a otro perfil.',
      );
    }
    throw new ServiceUnavailableException(
      'No se pudo completar la operación de estudiantes en PostgreSQL.',
    );
  }
}
