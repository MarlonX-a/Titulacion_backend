import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, LessThanOrEqual, Or, QueryFailedError, Repository } from 'typeorm';
import { CreateUsuarioDto } from './dto/create-usuario.dto.js';
import { ListUsuariosQueryDto } from './dto/list-usuarios-query.dto.js';
import { UsuarioResponseDto } from './dto/usuario-response.dto.js';
import { Usuario } from './entities/usuario.entity.js';
import { UsuarioEstado } from './enums/usuario-estado.enum.js';
import { UsuarioRol } from './enums/usuario-rol.enum.js';
import type { AppEnvironment } from '../config/environment.js';
import { decryptTemporarySecret, generateOneTimeSecret, importTempTtlMs, persistTemporaryPassword, readEncryptionKey, setTemporaryPassword } from '../auth/credentials.js';
import { hashPassword } from '../auth/password-hasher.js';
import { CorreoSalida } from '../auth/entities/correo-salida.entity.js';
import { CredencialUsuario } from '../auth/entities/credencial-usuario.entity.js';
import { SesionUsuario } from '../auth/entities/sesion-usuario.entity.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { ClaveTemporalVisible } from '../auth/entities/clave-temporal-visible.entity.js';

/** Frecuencia máxima de escritura de `usuario.ultimo_acceso` (5 minutos). */
export const ULTIMO_ACCESO_INTERVALO_MS = 5 * 60 * 1000;

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
export class UsuariosService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UsuariosService.name);
  private cleanupTimer: NodeJS.Timeout | undefined;
  constructor(
    @InjectRepository(Usuario)
    private readonly repository: Repository<Usuario>,
    private readonly dataSource: DataSource,
    @Optional() private readonly config?: ConfigService<AppEnvironment, true>,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  onModuleInit(): void {
    this.cleanupTimer = setInterval(() => void this.eliminarClavesTemporalesVencidas(), 5 * 60 * 1000);
    this.cleanupTimer.unref();
    void this.eliminarClavesTemporalesVencidas();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async create(dto: CreateUsuarioDto, actor?: Usuario, ip: string | null = null): Promise<UsuarioResponseDto> {
    try {
      const usuario = await this.dataSource.transaction((manager) => this.crearCuenta(manager, dto, actor, ip));
      return responseFrom(usuario);
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  /**
   * Crea la cuenta ACTIVA con clave temporal aleatoria y su correo ACCESO cifrado dentro de la
   * transacción del llamador, para que otros módulos (perfil docente) sean atómicos con el alta.
   */
  async crearCuenta(manager: EntityManager, dto: CreateUsuarioDto, actor?: Usuario, ip: string | null = null): Promise<Usuario> {
    const users = manager.getRepository(Usuario);
    const created = await users.save(users.create({
      email: dto.email.trim().toLowerCase(), nombres: dto.nombres.trim(), apellidos: dto.apellidos.trim(),
      rol: dto.rol, id_externo_sso: null, estado: UsuarioEstado.ACTIVO, ultimo_acceso: null,
    }));
    const temporaryPassword = generateOneTimeSecret();
    const temporaryKey = this.readKey('TEMP_CREDENTIAL_ENCRYPTION_KEY_PATH', 'La clave temporal no puede almacenarse de forma segura.');
    if (this.emailEnabled()) {
      const encryptionKey = this.readKey('OUTBOX_ENCRYPTION_KEY_PATH', 'El correo de acceso no puede prepararse.');
      await manager.getRepository(CorreoSalida).save(await setTemporaryPassword(manager, created.id, temporaryPassword, encryptionKey, temporaryKey));
    } else {
      const expiry = new Date(Date.now() + 72 * 60 * 60 * 1000);
      await persistTemporaryPassword(manager, created.id, temporaryPassword, await hashPassword(temporaryPassword), expiry, temporaryKey);
    }
    if (actor && this.auditoria) await this.auditoria.registrar(manager, { actor, accion: 'CREAR_USUARIO', entidad_tipo: 'usuario', entidad_id: created.id, valores_anteriores: null, valores_nuevos: { email: created.email, nombres: created.nombres, apellidos: created.apellidos, rol: created.rol, estado: created.estado }, ip_origen: ip });
    return created;
  }

  /**
   * Revoca las sesiones vigentes de una cuenta (misma regla que un cambio de contraseña):
   * marca las sesiones como revocadas e incrementa la versión de sesión de la credencial.
   */
  async revocarSesiones(manager: EntityManager, usuarioId: string): Promise<void> {
    const credentials = manager.getRepository(CredencialUsuario);
    const credential = await credentials.findOne({ where: { usuario_id: usuarioId }, lock: { mode: 'pessimistic_write' } });
    if (credential) {
      credential.version_sesion += 1;
      credential.actualizada_en = new Date();
      await credentials.save(credential);
    }
    await manager.getRepository(SesionUsuario).update({ usuario_id: usuarioId, revocada_en: IsNull() }, { revocada_en: new Date() });
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
        const temporaryKey = this.readKey('TEMP_CREDENTIAL_ENCRYPTION_KEY_PATH', 'La clave temporal no puede almacenarse de forma segura.');
        const outbox = manager.getRepository(CorreoSalida);
        const pending = await outbox.find({ where: { usuario_id: id, enviado_en: IsNull() } });
        for (const old of pending) { old.secreto_cifrado = ''; old.nonce = ''; old.tag = ''; old.expira_en = new Date(); }
        if (pending.length) await outbox.save(pending);
        const password = generateOneTimeSecret();
        if (this.emailEnabled()) {
          const encryptionKey = this.readKey('OUTBOX_ENCRYPTION_KEY_PATH', 'El correo de acceso no puede prepararse.');
          await outbox.save(await setTemporaryPassword(manager, id, password, encryptionKey, temporaryKey));
        } else {
          await persistTemporaryPassword(manager, id, password, await hashPassword(password), new Date(Date.now() + 72 * 60 * 60 * 1000), temporaryKey, current);
        }
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

  /** ADMIN puede recuperar una clave vigente o rotarla si expiró/no hay copia cifrada legible. */
  async revealOrRotateTemporaryPassword(id: string, actor: Usuario, ip: string | null): Promise<{ clave_temporal: string; expira_en: Date; regenerada: boolean }> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const users = manager.getRepository(Usuario);
        const admin = await users.findOne({ where: { id: actor.id }, lock: { mode: 'pessimistic_write' } });
        if (!admin || admin.estado !== UsuarioEstado.ACTIVO || admin.rol !== UsuarioRol.ADMIN) throw new ForbiddenException('Se requiere una cuenta ADMIN activa.');
        const target = await users.findOne({ where: { id, rol: UsuarioRol.ESTUDIANTE }, lock: { mode: 'pessimistic_write' } });
        if (!target) throw new NotFoundException('No existe la cuenta estudiantil indicada.');
        if (target.estado !== UsuarioEstado.ACTIVO) throw new ConflictException('La cuenta está inactiva; actívela antes de generar una clave temporal.');
        const credentialsRepo = manager.getRepository(CredencialUsuario);
        const credential = await credentialsRepo.findOne({ where: { usuario_id: id }, lock: { mode: 'pessimistic_write' } });
        if (!credential?.requiere_cambio) throw new ConflictException('La cuenta ya estableció una contraseña personal. Use el proceso de restablecimiento de acceso.');

        const now = new Date();
        const temporaryKey = this.readKey('TEMP_CREDENTIAL_ENCRYPTION_KEY_PATH', 'La clave temporal no está disponible de forma segura.');
        const stored = await manager.getRepository(ClaveTemporalVisible).findOne({ where: { usuario_id: id }, lock: { mode: 'pessimistic_write' } });
        if (credential.password_hash && credential.temporal_expira_en && credential.temporal_expira_en > now &&
            stored && stored.expira_en.getTime() === credential.temporal_expira_en.getTime()) {
          let secret: string | null = null;
          try {
            secret = decryptTemporarySecret(stored, temporaryKey);
          } catch {
            // Una copia ilegible se sustituye con una clave nueva; nunca se registra el fallo criptográfico.
          }
          if (secret !== null) {
            await this.auditoria?.registrar(manager, { actor: admin, accion: 'REVELAR_CLAVE_TEMPORAL', entidad_tipo: 'usuario', entidad_id: id, valores_anteriores: null, valores_nuevos: { expira_en: stored.expira_en, clave_revelada: true }, ip_origen: ip });
            return { clave_temporal: secret, expira_en: stored.expira_en, regenerada: false };
          }
        }

        const pending = await manager.getRepository(CorreoSalida).find({ where: { usuario_id: id, enviado_en: IsNull() } });
        for (const item of pending) { item.secreto_cifrado = ''; item.nonce = ''; item.tag = ''; item.expira_en = now; }
        if (pending.length) await manager.getRepository(CorreoSalida).save(pending);
        const password = generateOneTimeSecret();
        const ttlMs = importTempTtlMs(this.config?.get('IMPORT_TEMP_TTL_HOURS', { infer: true }));
        const expiry = new Date(Date.now() + ttlMs);
        if (this.emailEnabled()) {
          const outboxEncryptionKey = this.readKey('OUTBOX_ENCRYPTION_KEY_PATH', 'El correo de acceso no puede prepararse.');
          await manager.getRepository(CorreoSalida).save(await setTemporaryPassword(manager, id, password, outboxEncryptionKey, temporaryKey, ttlMs));
        } else {
          await persistTemporaryPassword(manager, id, password, await hashPassword(password), expiry, temporaryKey, credential);
        }
        await manager.getRepository(SesionUsuario).update({ usuario_id: id, revocada_en: IsNull() }, { revocada_en: now });
        await this.auditoria?.registrar(manager, { actor: admin, accion: 'GENERAR_CLAVE_TEMPORAL_ADMIN', entidad_tipo: 'usuario', entidad_id: id, valores_anteriores: { requiere_cambio: true, expira_en: credential.temporal_expira_en }, valores_nuevos: { requiere_cambio: true, expira_en: expiry, clave_revelada: true }, ip_origen: ip });
        return { clave_temporal: password, expira_en: expiry, regenerada: true };
      });
    } catch (error: unknown) {
      if (error instanceof ConflictException || error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof ServiceUnavailableException) throw error;
      this.handleDatabaseError(error);
    }
  }

  private readKey(name: 'OUTBOX_ENCRYPTION_KEY_PATH' | 'TEMP_CREDENTIAL_ENCRYPTION_KEY_PATH', message: string): string {
    const path = this.config?.get(name, { infer: true });
    if (!path) throw new ServiceUnavailableException(message);
    try { return readEncryptionKey(path); } catch { throw new ServiceUnavailableException(message); }
  }

  private emailEnabled(): boolean {
    return this.config?.get('EMAIL_ENABLED', { infer: true }) !== false;
  }

  private async eliminarClavesTemporalesVencidas(): Promise<void> {
    if (!this.dataSource.isInitialized) return;
    try {
      await this.dataSource.getRepository(ClaveTemporalVisible).createQueryBuilder()
        .delete().where('"expira_en" <= CURRENT_TIMESTAMP').execute();
    } catch {
      this.logger.warn('No se pudieron limpiar copias cifradas de claves temporales vencidas.');
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

  /**
   * Registra el último acceso como mucho una vez cada `ULTIMO_ACCESO_INTERVALO_MS` por usuario,
   * para no escribir en `usuario` en cada solicitud. `previous` es el valor ya leído; la
   * condición se repite en el UPDATE, así que solicitudes simultáneas escriben una sola vez.
   * Devuelve el último acceso vigente.
   */
  async recordAccess(id: string, previous: Date | null): Promise<Date | null> {
    const now = new Date();
    const threshold = new Date(now.getTime() - ULTIMO_ACCESO_INTERVALO_MS);
    if (previous !== null && previous > threshold) return previous;
    try {
      const result = await this.repository.update(
        { id, ultimo_acceso: Or(IsNull(), LessThanOrEqual(threshold)) },
        { ultimo_acceso: now },
      );
      return result.affected ? now : previous;
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
          password_hash: await hashPassword(dto.password),
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
