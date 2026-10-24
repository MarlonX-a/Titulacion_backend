import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { argon2id, hash } from 'argon2';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, QueryFailedError, Repository } from 'typeorm';
import { CreateUsuarioDto } from './dto/create-usuario.dto.js';
import { ListUsuariosQueryDto } from './dto/list-usuarios-query.dto.js';
import { UsuarioResponseDto } from './dto/usuario-response.dto.js';
import { Usuario } from './entities/usuario.entity.js';
import { UsuarioEstado } from './enums/usuario-estado.enum.js';
import { UsuarioRol } from './enums/usuario-rol.enum.js';
import type { AppEnvironment } from '../config/environment.js';
import { generateOneTimeSecret, readEncryptionKey, setTemporaryPassword } from '../auth/credentials.js';
import { CorreoSalida } from '../auth/entities/correo-salida.entity.js';
import { CredencialUsuario } from '../auth/entities/credencial-usuario.entity.js';
import { SesionUsuario } from '../auth/entities/sesion-usuario.entity.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';

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
    @Optional() private readonly config?: ConfigService<AppEnvironment, true>,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  async create(dto: CreateUsuarioDto, actor?: Usuario, ip: string | null = null): Promise<UsuarioResponseDto> {
    try {
      const usuario = await this.dataSource.transaction(async (manager) => {
        const users = manager.getRepository(Usuario);
        const created = await users.save(users.create({
          email: dto.email.trim().toLowerCase(), nombres: dto.nombres.trim(), apellidos: dto.apellidos.trim(),
          rol: dto.rol, id_externo_sso: null, estado: UsuarioEstado.ACTIVO, ultimo_acceso: null,
        }));
        const temporaryPassword = generateOneTimeSecret();
        const encryptionKeyPath = this.config?.get('OUTBOX_ENCRYPTION_KEY_PATH', { infer: true });
        if (!encryptionKeyPath) throw new ServiceUnavailableException('El correo de acceso no puede prepararse: falta la clave de cifrado.');
        const encryptionKey = readEncryptionKey(encryptionKeyPath);
        const outbox = await setTemporaryPassword(manager, created.id, temporaryPassword, encryptionKey);
        await manager.getRepository(CorreoSalida).save(outbox);
        if (actor && this.auditoria) await this.auditoria.registrar(manager, { actor, accion: 'CREAR_USUARIO', entidad_tipo: 'usuario', entidad_id: created.id, valores_anteriores: null, valores_nuevos: { email: created.email, nombres: created.nombres, apellidos: created.apellidos, rol: created.rol, estado: created.estado }, ip_origen: ip });
        return created;
      });
      return responseFrom(usuario);
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  async reissueAccess(id: string, actor: Usuario, ip: string | null): Promise<UsuarioResponseDto> {
    try {
      const user = await this.dataSource.transaction(async (manager) => {
        const target = await manager.getRepository(Usuario).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
        if (!target) throw new ConflictException('No existe la cuenta indicada.');
        if (target.estado !== UsuarioEstado.ACTIVO) throw new ForbiddenException('La cuenta está inactiva.');
        const credentials = manager.getRepository(CredencialUsuario);
        const current = await credentials.findOne({ where: { usuario_id: id }, lock: { mode: 'pessimistic_write' } });
        if (current && !current.requiere_cambio) throw new ConflictException('La cuenta ya estableció una contraseña personal.');
        const keyPath = this.config?.get('OUTBOX_ENCRYPTION_KEY_PATH', { infer: true });
        if (!keyPath) throw new ServiceUnavailableException('El correo de acceso no puede prepararse.');
        const encryptionKey = readEncryptionKey(keyPath);
        const outbox = manager.getRepository(CorreoSalida);
        const pending = await outbox.find({ where: { usuario_id: id, enviado_en: IsNull() } });
        for (const old of pending) { old.secreto_cifrado = ''; old.nonce = ''; old.tag = ''; old.expira_en = new Date(); }
        if (pending.length) await outbox.save(pending);
        const password = generateOneTimeSecret();
        await outbox.save(await setTemporaryPassword(manager, id, password, encryptionKey));
        await manager.getRepository(SesionUsuario).update({ usuario_id: id, revocada_en: IsNull() }, { revocada_en: new Date() });
        if (this.auditoria) await this.auditoria.registrar(manager, { actor, accion: 'REENVIAR_ACCESO_USUARIO', entidad_tipo: 'usuario', entidad_id: id, valores_anteriores: { requiere_cambio: current?.requiere_cambio ?? true }, valores_nuevos: { requiere_cambio: true, acceso_temporal_reenviado: true }, ip_origen: ip });
        return target;
      });
      return responseFrom(user);
    } catch (error: unknown) {
      if (error instanceof ConflictException || error instanceof ForbiddenException || error instanceof ServiceUnavailableException) throw error;
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

  async getActiveById(id: string): Promise<Usuario> {
    let usuario: Usuario | null;
    try {
      usuario = await this.repository.findOneBy({ id });
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
    if (!usuario || usuario.estado !== UsuarioEstado.ACTIVO) {
      throw new ForbiddenException('La cuenta no está activa en el sistema.');
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
    dto: Omit<CreateUsuarioDto, 'rol'> & { password: string },
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

        const user = await repository.save(
          repository.create({
            email: dto.email.trim().toLowerCase(),
            nombres: dto.nombres.trim(),
            apellidos: dto.apellidos.trim(),
            rol: UsuarioRol.ADMIN,
            estado: UsuarioEstado.ACTIVO,
            ultimo_acceso: null,
            id_externo_sso: null,
          }),
        );
        const credential = manager.getRepository(CredencialUsuario);
        await credential.save(credential.create({
          usuario_id: user.id,
          password_hash: await hash(dto.password, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }),
          requiere_cambio: false,
          temporal_expira_en: null,
          version_sesion: 0,
          actualizada_en: new Date(),
        }));
        return user;
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
