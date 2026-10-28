import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { UsuarioResumenDto } from '../common/dto/usuario-resumen.dto.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { UsuariosService } from '../usuarios/usuarios.service.js';
import { CreateDocenteDto } from './dto/create-docente.dto.js';
import { DocenteResponseDto } from './dto/docente-response.dto.js';
import { UpdateDocenteDto } from './dto/update-docente.dto.js';
import { Docente } from './entities/docente.entity.js';

interface PostgresDriverError {
  code?: string;
  constraint?: string;
}

export interface PagedDocentes {
  data: DocenteResponseDto[];
  total: number;
  page: number;
  limit: number;
}

type CambiosCuenta = Partial<Pick<Usuario, 'nombres' | 'apellidos' | 'estado'>>;
type CambiosPerfil = Partial<
  Pick<Docente, 'cedula' | 'titulo_academico' | 'departamento' | 'habilitado_tutoria'>
>;

const CEDULA_DUPLICADA = 'La cédula ya está registrada en otro docente.';
const EMAIL_DUPLICADO =
  'Ya existe una cuenta con ese correo; vincúlala con usuario_id.';

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

function driverError(error: unknown): PostgresDriverError | null {
  return error instanceof QueryFailedError
    ? (error.driverError as PostgresDriverError)
    : null;
}

function auditValues(docente: Docente, usuario: Usuario): Record<string, unknown> {
  return {
    usuario_id: usuario.id,
    nombres: usuario.nombres,
    apellidos: usuario.apellidos,
    estado: usuario.estado,
    cedula: docente.cedula,
    titulo_academico: docente.titulo_academico,
    departamento: docente.departamento,
    habilitado_tutoria: docente.habilitado_tutoria,
  };
}

function accountChanges(dto: UpdateDocenteDto, usuario: Usuario): CambiosCuenta {
  const changes: CambiosCuenta = {};
  if (dto.nombres !== undefined && dto.nombres !== usuario.nombres) changes.nombres = dto.nombres;
  if (dto.apellidos !== undefined && dto.apellidos !== usuario.apellidos) {
    changes.apellidos = dto.apellidos;
  }
  if (dto.estado !== undefined && dto.estado !== usuario.estado) changes.estado = dto.estado;
  return changes;
}

function profileChanges(dto: UpdateDocenteDto, docente: Docente): CambiosPerfil {
  const changes: CambiosPerfil = {};
  if (dto.cedula !== undefined && dto.cedula !== docente.cedula) changes.cedula = dto.cedula;
  if (dto.titulo_academico !== undefined && dto.titulo_academico !== docente.titulo_academico) {
    changes.titulo_academico = dto.titulo_academico;
  }
  if (dto.departamento !== undefined && dto.departamento !== docente.departamento) {
    changes.departamento = dto.departamento;
  }
  if (
    dto.habilitado_tutoria !== undefined &&
    dto.habilitado_tutoria !== docente.habilitado_tutoria
  ) {
    changes.habilitado_tutoria = dto.habilitado_tutoria;
  }
  return changes;
}

@Injectable()
export class DocentesService {
  constructor(
    @InjectRepository(Docente)
    private readonly repository: Repository<Docente>,
    private readonly dataSource: DataSource,
    private readonly usuarios: UsuariosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Con `usuario_id` vincula una cuenta DOCENTE activa; sin él crea la cuenta (clave temporal y
   * correo ACCESO cifrado) y el perfil en una única transacción con auditoría.
   */
  async create(
    dto: CreateDocenteDto,
    actor: Usuario,
    ip: string | null,
  ): Promise<DocenteResponseDto> {
    try {
      const docente = await this.dataSource.transaction(async (manager) => {
        const docentes = manager.getRepository(Docente);
        const cedula = dto.cedula.trim();
        if (await docentes.findOne({ where: { cedula } })) {
          throw new ConflictException(CEDULA_DUPLICADA);
        }
        const usuario = dto.usuario_id
          ? await this.lockLinkableAccount(manager, dto.usuario_id)
          : await this.createAccount(manager, dto, actor, ip);
        const saved = await docentes.save(
          docentes.create({
            usuario,
            cedula,
            titulo_academico: dto.titulo_academico.trim(),
            departamento: dto.departamento.trim(),
            habilitado_tutoria: dto.habilitado_tutoria ?? false,
          }),
        );
        await this.auditoria.registrar(manager, {
          actor,
          accion: 'CREAR_DOCENTE',
          entidad_tipo: 'docente',
          entidad_id: saved.id,
          valores_anteriores: null,
          valores_nuevos: { ...auditValues(saved, usuario), cuenta_creada: !dto.usuario_id },
          ip_origen: ip,
        });
        return saved;
      });
      return responseFrom(docente);
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  /**
   * Edita la cuenta (nombres, apellidos, estado) y el perfil en una transacción con auditoría
   * antes/después. El correo no se edita. Pasar a INACTIVO revoca las sesiones vigentes; no
   * modifica tutorías, asignaciones ni límites de carga existentes.
   */
  async update(
    id: string,
    dto: UpdateDocenteDto,
    actor: Usuario,
    ip: string | null,
  ): Promise<DocenteResponseDto> {
    if (Object.values(dto).every((value) => value === undefined)) {
      throw new BadRequestException('Debe indicar al menos un campo para modificar.');
    }
    try {
      const updated = await this.dataSource.transaction(async (manager) => {
        const { docente, usuario } = await this.lockDocente(manager, id);
        const before = auditValues(docente, usuario);
        const cuenta = accountChanges(dto, usuario);
        const perfil = profileChanges(dto, docente);
        if (Object.keys(cuenta).length === 0 && Object.keys(perfil).length === 0) {
          return { ...docente, usuario };
        }
        const docentes = manager.getRepository(Docente);
        if (perfil.cedula !== undefined) {
          const owner = await docentes.findOne({ where: { cedula: perfil.cedula } });
          if (owner && owner.id !== docente.id) throw new ConflictException(CEDULA_DUPLICADA);
        }
        if (Object.keys(cuenta).length > 0) {
          await manager.getRepository(Usuario).update({ id: usuario.id }, cuenta);
          Object.assign(usuario, cuenta);
        }
        if (Object.keys(perfil).length > 0) {
          await docentes.update({ id: docente.id }, perfil);
          Object.assign(docente, perfil);
        }
        const sesionesRevocadas = cuenta.estado === UsuarioEstado.INACTIVO;
        if (sesionesRevocadas) await this.usuarios.revocarSesiones(manager, usuario.id);
        await this.auditoria.registrar(manager, {
          actor,
          accion: 'EDITAR_DOCENTE',
          entidad_tipo: 'docente',
          entidad_id: docente.id,
          valores_anteriores: before,
          valores_nuevos: {
            ...auditValues(docente, usuario),
            ...(sesionesRevocadas ? { sesiones_revocadas: true } : {}),
          },
          ip_origen: ip,
        });
        return { ...docente, usuario };
      });
      return responseFrom(updated);
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

  private async createAccount(
    manager: EntityManager,
    dto: CreateDocenteDto,
    actor: Usuario,
    ip: string | null,
  ): Promise<Usuario> {
    const email = (dto.email ?? '').trim().toLowerCase();
    if (await manager.getRepository(Usuario).findOne({ where: { email } })) {
      throw new ConflictException(EMAIL_DUPLICADO);
    }
    return this.usuarios.crearCuenta(
      manager,
      {
        email,
        nombres: dto.nombres ?? '',
        apellidos: dto.apellidos ?? '',
        rol: UsuarioRol.DOCENTE,
      },
      actor,
      ip,
    );
  }

  private async lockLinkableAccount(
    manager: EntityManager,
    usuarioId: string,
  ): Promise<Usuario> {
    const usuario = await manager.getRepository(Usuario).findOne({
      where: { id: usuarioId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!usuario) {
      throw new NotFoundException('No existe la cuenta indicada.');
    }
    if (usuario.estado !== UsuarioEstado.ACTIVO || usuario.rol !== UsuarioRol.DOCENTE) {
      throw new ConflictException('La cuenta debe estar activa y tener rol DOCENTE.');
    }
    return usuario;
  }

  /** Bloquea cuenta y perfil (en ese orden) para editar ambos de forma atómica. */
  private async lockDocente(
    manager: EntityManager,
    id: string,
  ): Promise<{ docente: Docente; usuario: Usuario }> {
    const docentes = manager.getRepository(Docente);
    const current = await docentes.findOne({ where: { id }, relations: { usuario: true } });
    if (!current) throw new NotFoundException('No existe el perfil de docente solicitado.');
    const usuario = await manager.getRepository(Usuario).findOne({
      where: { id: current.usuario.id },
      lock: { mode: 'pessimistic_write' },
    });
    const docente = await docentes.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!usuario || !docente) {
      throw new NotFoundException('No existe el perfil de docente solicitado.');
    }
    if (usuario.rol !== UsuarioRol.DOCENTE) {
      throw new ConflictException('La cuenta vinculada no tiene rol DOCENTE.');
    }
    return { docente, usuario };
  }

  private handleDatabaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    const driver = driverError(error);
    if (driver?.code === '23505' && driver.constraint === 'UQ_docente_cedula') {
      throw new ConflictException(CEDULA_DUPLICADA);
    }
    if (driver?.code === '23505' && driver.constraint === 'UQ_usuario_email') {
      throw new ConflictException(EMAIL_DUPLICADO);
    }
    if (driver?.code === '23505' || driver?.code === '23503') {
      throw new ConflictException('La cuenta o cédula ya está vinculada a otro perfil.');
    }
    throw new ServiceUnavailableException(
      'No se pudo completar la operación de docentes en PostgreSQL.',
    );
  }
}
