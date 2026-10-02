import {
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { CreateUsuarioDto } from './dto/create-usuario.dto.js';
import { ListUsuariosQueryDto } from './dto/list-usuarios-query.dto.js';
import { UsuarioResponseDto } from './dto/usuario-response.dto.js';
import { Usuario } from './entities/usuario.entity.js';
import { UsuarioEstado } from './enums/usuario-estado.enum.js';
import { UsuarioRol } from './enums/usuario-rol.enum.js';

interface PostgresDriverError {
  code?: string;
}

export interface PagedUsuarios {
  data: UsuarioResponseDto[];
  total: number;
  page: number;
  limit: number;
}

function responseFrom(usuario: Usuario): UsuarioResponseDto {
  return {
    id: usuario.id,
    email: usuario.email,
    nombres: usuario.nombres,
    apellidos: usuario.apellidos,
    rol: usuario.rol,
    estado: usuario.estado,
    ultimo_acceso: usuario.ultimo_acceso,
    creado_en: usuario.creado_en,
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as PostgresDriverError;
  return driverError.code === '23505';
}

@Injectable()
export class UsuariosService {
  constructor(
    @InjectRepository(Usuario)
    private readonly repository: Repository<Usuario>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateUsuarioDto): Promise<UsuarioResponseDto> {
    try {
      const usuario = this.repository.create({
        email: dto.email.trim().toLowerCase(),
        nombres: dto.nombres.trim(),
        apellidos: dto.apellidos.trim(),
        rol: dto.rol,
        id_externo_sso: dto.id_externo_sso,
        estado: UsuarioEstado.ACTIVO,
        ultimo_acceso: null,
      });
      return responseFrom(await this.repository.save(usuario));
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  async list(query: ListUsuariosQueryDto): Promise<PagedUsuarios> {
    try {
      const [usuarios, total] = await this.repository.findAndCount({
        order: { creado_en: 'ASC', id: 'ASC' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      return {
        data: usuarios.map(responseFrom),
        total,
        page: query.page,
        limit: query.limit,
      };
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  async getActiveByExternalId(idExternoSso: string): Promise<Usuario> {
    let usuario: Usuario | null;
    try {
      usuario = await this.repository.findOneBy({
        id_externo_sso: idExternoSso,
      });
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }

    if (!usuario || usuario.estado !== UsuarioEstado.ACTIVO) {
      throw new ForbiddenException(
        'La identidad institucional no tiene una cuenta activa en el sistema.',
      );
    }
    return usuario;
  }

  async getCurrentProfile(usuario: Usuario): Promise<UsuarioResponseDto> {
    return responseFrom(usuario);
  }

  async recordAccess(id: string): Promise<Date> {
    const lastAccess = new Date();
    try {
      await this.repository.update({ id }, { ultimo_acceso: lastAccess });
      return lastAccess;
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  async createInitialAdmin(
    dto: Omit<CreateUsuarioDto, 'rol'>,
  ): Promise<UsuarioResponseDto> {
    try {
      const usuario = await this.dataSource.transaction(async (manager) => {
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          ['titulacion.bootstrap-admin'],
        );

        const repository = manager.getRepository(Usuario);
        const existingAdmins = await repository.countBy({
          rol: UsuarioRol.ADMIN,
        });
        if (existingAdmins > 0) {
          throw new ConflictException(
            'Ya existe un usuario ADMIN; no se puede volver a inicializar.',
          );
        }

        return repository.save(
          repository.create({
            ...dto,
            email: dto.email.trim().toLowerCase(),
            nombres: dto.nombres.trim(),
            apellidos: dto.apellidos.trim(),
            rol: UsuarioRol.ADMIN,
            estado: UsuarioEstado.ACTIVO,
            ultimo_acceso: null,
          }),
        );
      });
      return responseFrom(usuario);
    } catch (error: unknown) {
      if (error instanceof ConflictException) throw error;
      this.handleDatabaseError(error);
    }
  }

  private handleDatabaseError(error: unknown): never {
    if (isUniqueViolation(error)) {
      throw new ConflictException(
        'Ya existe un usuario con ese correo o identificador institucional.',
      );
    }

    throw new ServiceUnavailableException(
      'No se pudo completar la operación de usuarios en la base de datos.',
    );
  }
}
