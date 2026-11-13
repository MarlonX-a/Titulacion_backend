import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, Logger, OnModuleDestroy, OnModuleInit,
  ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { SignJWT, importPKCS8, importSPKI, jwtVerify, type CryptoKey } from 'jose';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { AppEnvironment } from '../config/environment.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { AuthRateLimiterService } from './auth-rate-limiter.service.js';
import { CorreoSalida } from './entities/correo-salida.entity.js';
import { CredencialUsuario } from './entities/credencial-usuario.entity.js';
import { SesionUsuario } from './entities/sesion-usuario.entity.js';
import { SesionRefreshHash } from './entities/sesion-refresh-hash.entity.js';
import { SolicitudRecuperacion } from './entities/solicitud-recuperacion.entity.js';
import { PrimerAccesoService } from './primer-acceso.service.js';
import { createEncryptedOutbox, generateOneTimeSecret, readEncryptionKey, tokenDigest } from './credentials.js';
import { LoginThrottle, type IntentoLogin } from './login-throttle.js';
import { DUMMY_HASH, hashPassword, needsRehash, verifyPassword } from './password-hasher.js';
import { MENSAJE_POLITICA_CLAVE, cumplePoliticaClave } from './password-policy.validator.js';
import type { LoginDto } from './dto/login.dto.js';
import type { ChangePasswordDto, ForgotPasswordDto, NewPasswordDto, ResetPasswordDto } from './dto/password.dto.js';
import type { AuthenticatedIdentity } from './authenticated-identity.js';

const ACCESS_SECONDS = 15 * 60;
const FIRST_ACCESS_SECONDS = 10 * 60;
const SESSION_MS = 8 * 60 * 60 * 1000;
/** Inactividad máxima de una sesión: solo el uso real de la API la renueva, no el refresh. */
export const IDLE_MS = 30 * 60 * 1000;
/** `ultima_actividad` se actualiza como mucho una vez por minuto (sin escritura en el caso común). */
const ACTIVITY_WRITE_MS = 60 * 1000;
/** Ventana en la que un refresh recién rotado puede volver a presentarse una vez (dos pestañas). */
export const REFRESH_GRACE_MS = 10 * 1000;
const RESET_MS = 30 * 60 * 1000;
const TOKEN_AUDIENCE = 'titulacion-api';
const GENERIC_LOGIN = 'Correo o contraseña incorrectos.';
const INVALID_TOKEN = 'El token no es válido o la sesión venció.';
const INVALID_RESET_CODE = 'El código de recuperación no es válido o venció.';
export const REFRESH_CONCURRENTE = 'REFRESH_CONCURRENTE';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FORGOT_IP_LIMIT = 60;
const FORGOT_EMAIL_LIMIT = 3;
const FORGOT_WINDOW_SECONDS = 3600;
const RESET_IP_FAILURE_LIMIT = 30;
const RESET_IP_WINDOW_SECONDS = 900;
const REFRESH_LIMIT = 30;
const REFRESH_WINDOW_SECONDS = 60;
const CHANGE_LIMIT = 5;
const FIRST_ACCESS_LIMIT = 10;
const CHANGE_WINDOW_SECONDS = 900;

export interface AuthenticationResult {
  response: { access_token: string; token_type: 'Bearer'; expires_in: number; requiere_cambio_clave?: boolean; csrf_token?: string };
  refresh_cookie?: string;
  csrf_cookie?: string;
  /** Cookie de dispositivo conocido; solo en un inicio de sesión completo. */
  device_cookie?: string;
}

export interface VerifiedIdentity extends AuthenticatedIdentity {
  sessionId?: string;
  firstAccess: boolean;
}

/** 401 de credenciales con la cuenta afectada (si existe) para contar y auditar el fallo. */
class LoginFailure extends UnauthorizedException {
  constructor(readonly usuarioId: string | null) {
    super(GENERIC_LOGIN);
  }
}

type RefreshOutcome =
  | { kind: 'rotated'; userId: string; sessionId: string }
  | { kind: 'concurrent' }
  | { kind: 'replayed' }
  | { kind: 'idle' };

@Injectable()
export class AuthenticationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthenticationService.name);
  private readonly issuer: string;
  private privateKey!: CryptoKey;
  private publicKey!: CryptoKey;
  private readonly encryptionKey: string;
  private readonly privateKeyPath?: string;
  private readonly publicKeyPath?: string;
  private readonly throttle: LoginThrottle;
  /** Trabajo de recuperación desacoplado de la respuesta HTTP; se espera al cerrar el módulo. */
  private readonly pendingRecoveries = new Set<Promise<void>>();

  constructor(
    config: ConfigService<AppEnvironment, true>,
    private readonly dataSource: DataSource,
    private readonly limiter: AuthRateLimiterService,
    private readonly auditoria: AuditoriaService,
    private readonly primerAcceso: PrimerAccesoService,
  ) {
    this.issuer = config.get('AUTH_ISSUER', { infer: true });
    const keyPath = config.get('OUTBOX_ENCRYPTION_KEY_PATH', { infer: true });
    this.encryptionKey = keyPath ? readEncryptionKey(keyPath) : '';
    this.privateKeyPath = config.get('JWT_PRIVATE_KEY_PATH', { infer: true });
    this.publicKeyPath = config.get('JWT_PUBLIC_KEY_PATH', { infer: true });
    this.throttle = new LoginThrottle(
      limiter,
      (evento, usuarioId, ip, detalles) => this.auditoria.registrarEventoSeguridad(null, evento, { usuarioId, ip, detalles }),
      async (email) => (await this.dataSource.getRepository(Usuario).findOneBy({ email }))?.id ?? null,
      this.logger,
    );
  }

  /** Las claves JWT persistentes son obligatorias en todo entorno; las pruebas las aportan por configuración. */
  async onModuleInit(): Promise<void> {
    try {
      if (!this.privateKeyPath || !this.publicKeyPath) throw new Error('No se configuraron claves JWT persistentes.');
      this.privateKey = await importPKCS8(readFileSync(this.privateKeyPath, 'utf8'), 'RS256');
      this.publicKey = await importSPKI(readFileSync(this.publicKeyPath, 'utf8'), 'RS256');
    } catch {
      this.logger.error('No se pudieron cargar las claves de autenticación.');
      throw new ServiceUnavailableException('La autenticación no está configurada.');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled(this.pendingRecoveries);
  }

  async login(dto: LoginDto, ip: string, deviceCookie?: string): Promise<AuthenticationResult> {
    try {
      const email = dto.email.trim().toLowerCase();
      const intento = await this.throttle.begin(email, ip, deviceCookie);
      return await this.authenticate(email, dto.password, intento);
    } catch (error: unknown) {
      this.rethrowAuthenticationError(error);
    }
  }

  private async authenticate(email: string, password: string, intento: IntentoLogin): Promise<AuthenticationResult> {
    let result: AuthenticationResult;
    try {
      result = await this.verifyCredentialsAndOpenSession(email, password, intento.ip);
    } catch (error: unknown) {
      // Solo un fallo de credenciales conserva los cupos reservados; un error interno los devuelve.
      if (error instanceof LoginFailure) await this.throttle.failed(intento, error.usuarioId);
      else await this.throttle.refund(intento);
      throw error;
    }
    await this.throttle.refund(intento);
    if (result.refresh_cookie) {
      const device = await this.throttle.succeeded(intento);
      if (device) result.device_cookie = device;
    }
    return result;
  }

  private async verifyCredentialsAndOpenSession(email: string, password: string, ip: string): Promise<AuthenticationResult> {
    const user = await this.dataSource.getRepository(Usuario).findOneBy({ email });
    const credentials = user ? await this.dataSource.getRepository(CredencialUsuario).findOneBy({ usuario_id: user.id }) : null;
    const valid = await verifyPassword(credentials?.password_hash ?? DUMMY_HASH, password);
    if (!user || !credentials?.password_hash || !valid) throw new LoginFailure(user?.id ?? null);
    // Cuenta inactiva con la contraseña correcta: mismo 401 genérico, para no revelar el estado.
    if (user.estado !== UsuarioEstado.ACTIVO) throw new LoginFailure(user.id);
    if (credentials.requiere_cambio) {
      if (!credentials.temporal_expira_en || credentials.temporal_expira_en <= new Date()) throw new LoginFailure(user.id);
      return { response: { access_token: await this.sign(user.id, undefined, true), token_type: 'Bearer', expires_in: FIRST_ACCESS_SECONDS, requiere_cambio_clave: true } };
    }
    const refresh = generateOneTimeSecret();
    const csrf = generateOneTimeSecret();
    const now = new Date();
    const session = await this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(SesionUsuario);
      const created = await sessions.save(sessions.create({
        usuario_id: user.id, refresh_hash: tokenDigest(refresh), refresh_anterior_hash: null,
        expira_en: new Date(now.getTime() + SESSION_MS), revocada_en: null, ultima_actividad: now,
      }));
      await manager.getRepository(SesionRefreshHash).insert({ sesion_id: created.id, refresh_hash: tokenDigest(refresh), consumida_en: null });
      await this.auditoria.registrarEventoSeguridad(manager, 'LOGIN_EXITOSO', { usuarioId: user.id, ip });
      return created;
    });
    await this.rehashIfNeeded(credentials, password);
    return {
      response: { access_token: await this.sign(user.id, session.id, false), token_type: 'Bearer', expires_in: ACCESS_SECONDS, csrf_token: csrf },
      refresh_cookie: `${session.id}.${refresh}`,
      csrf_cookie: csrf,
    };
  }

  /** Regenera el hash con los parámetros vigentes. Es oportunista: un fallo no afecta al inicio de sesión. */
  private async rehashIfNeeded(credentials: CredencialUsuario, password: string): Promise<void> {
    if (!credentials.password_hash || !needsRehash(credentials.password_hash)) return;
    try {
      const previous = credentials.password_hash;
      await this.dataSource.getRepository(CredencialUsuario).update(
        { usuario_id: credentials.usuario_id, password_hash: previous },
        { password_hash: await hashPassword(password) },
      );
    } catch {
      this.logger.warn('No se pudo actualizar el hash de una contraseña.');
    }
  }

  async verifyToken(token: string): Promise<VerifiedIdentity> {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, this.publicKey, {
        algorithms: ['RS256'], issuer: this.issuer, audience: TOKEN_AUDIENCE,
        requiredClaims: ['exp', 'sub', 'typ'],
      }));
    } catch {
      throw new UnauthorizedException(INVALID_TOKEN);
    }
    if (typeof payload.sub !== 'string' || typeof payload.typ !== 'string') throw new UnauthorizedException(INVALID_TOKEN);
    const firstAccess = payload.typ === 'first_access';
    if (payload.typ !== 'access' && !firstAccess) throw new UnauthorizedException(INVALID_TOKEN);
    try {
      if (firstAccess) {
        const user = await this.dataSource.getRepository(Usuario).findOneBy({ id: payload.sub, estado: UsuarioEstado.ACTIVO });
        if (!user) throw new UnauthorizedException(INVALID_TOKEN);
        const credential = await this.dataSource.getRepository(CredencialUsuario).findOneBy({ usuario_id: payload.sub });
        if (!credential?.requiere_cambio || !credential.temporal_expira_en || credential.temporal_expira_en <= new Date()) throw new UnauthorizedException(INVALID_TOKEN);
        return { subject: payload.sub, issuer: this.issuer, firstAccess };
      }
      if (typeof payload.sid !== 'string' || !UUID.test(payload.sid)) throw new UnauthorizedException(INVALID_TOKEN);
      const sessions = this.dataSource.getRepository(SesionUsuario);
      const session = await sessions.findOneBy({ id: payload.sid, usuario_id: payload.sub });
      const now = new Date();
      if (!session || session.revocada_en || session.expira_en <= now) throw new UnauthorizedException(INVALID_TOKEN);
      if (isIdle(session, now)) {
        await this.revokeIdleSession(session.id, session.usuario_id);
        throw new UnauthorizedException('La sesión se cerró por inactividad.');
      }
      if (!session.ultima_actividad || now.getTime() - session.ultima_actividad.getTime() > ACTIVITY_WRITE_MS) {
        await sessions.update({ id: session.id }, { ultima_actividad: now });
      }
      return { subject: payload.sub, issuer: this.issuer, sessionId: session.id, firstAccess };
    } catch (error: unknown) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.error('No se pudo comprobar una sesión de autenticación.');
      throw new ServiceUnavailableException('El servicio de autenticación no está disponible.');
    }
  }

  private async revokeIdleSession(sessionId: string, userId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const result = await manager.getRepository(SesionUsuario).update({ id: sessionId, revocada_en: IsNull() }, { revocada_en: new Date() });
      if (result.affected) await this.auditoria.registrarEventoSeguridad(manager, 'SESION_INACTIVA', { usuarioId: userId, ip: null });
    });
  }

  async changeInitialPassword(userId: string, dto: NewPasswordDto, ip: string): Promise<void> {
    try {
      await this.limiter.enforce(`first:${userId}`, FIRST_ACCESS_LIMIT, CHANGE_WINDOW_SECONDS);
      await this.dataSource.transaction(async (manager) => {
        const credentials = await manager.getRepository(CredencialUsuario).findOne({ where: { usuario_id: userId }, lock: { mode: 'pessimistic_write' } });
        if (!credentials?.requiere_cambio || !credentials.password_hash || !credentials.temporal_expira_en || credentials.temporal_expira_en <= new Date()) throw new UnauthorizedException('La clave temporal venció; solicita otra a ADMIN.');
        await this.assertPasswordPolicy(manager, userId, dto.password);
        if (await verifyPassword(credentials.password_hash, dto.password)) throw new ForbiddenException('La nueva contraseña debe ser distinta de la temporal.');
        credentials.requiere_cambio = false;
        credentials.temporal_expira_en = null;
        await this.replacePassword(manager, credentials, dto.password);
        await this.auditoria.registrarEventoSeguridad(manager, 'PRIMER_ACCESO', { usuarioId: userId, ip });
        await this.primerAcceso.avisarAlTitular(manager, userId);
      });
      await this.primerAcceso.vigilarActivacionesPorIp(ip);
    } catch (error: unknown) { this.rethrowAuthenticationError(error); }
  }

  async changePassword(userId: string, dto: ChangePasswordDto, ip: string): Promise<void> {
    try {
      await this.limiter.enforce(`chgpw:${userId}`, CHANGE_LIMIT, CHANGE_WINDOW_SECONDS);
      await this.dataSource.transaction(async (manager) => {
        const credentials = await manager.getRepository(CredencialUsuario).findOne({ where: { usuario_id: userId }, lock: { mode: 'pessimistic_write' } });
        if (!credentials?.password_hash || credentials.requiere_cambio || !await verifyPassword(credentials.password_hash, dto.current_password)) throw new UnauthorizedException('La contraseña actual no es correcta.');
        await this.assertPasswordPolicy(manager, userId, dto.password);
        if (await verifyPassword(credentials.password_hash, dto.password)) throw new ForbiddenException('La nueva contraseña debe ser distinta de la actual.');
        await this.replacePassword(manager, credentials, dto.password);
        await this.auditoria.registrarEventoSeguridad(manager, 'CAMBIO_CLAVE', { usuarioId: userId, ip });
      });
    } catch (error: unknown) { this.rethrowAuthenticationError(error); }
  }

  async refresh(rawCookie: string, ip: string): Promise<AuthenticationResult> {
    const [sessionId, refresh] = rawCookie.split('.', 2);
    if (!sessionId || !refresh || !UUID.test(sessionId)) throw new UnauthorizedException('La sesión no es válida.');
    const nextToken = generateOneTimeSecret();
    const csrf = generateOneTimeSecret();
    let outcome: RefreshOutcome;
    try {
      await this.limiter.enforce(`refresh:${tokenDigest(sessionId)}`, REFRESH_LIMIT, REFRESH_WINDOW_SECONDS);
      outcome = await this.dataSource.transaction((manager) => this.rotateRefresh(manager, sessionId, tokenDigest(refresh), tokenDigest(nextToken), ip));
    } catch (error: unknown) { this.rethrowAuthenticationError(error); }
    if (outcome.kind === 'concurrent') {
      throw new ConflictException({ statusCode: 409, code: REFRESH_CONCURRENTE, message: 'La sesión se renovó en otra pestaña; vuelve a intentarlo.' });
    }
    if (outcome.kind === 'replayed') throw new UnauthorizedException('Se detectó la reutilización de una sesión; inicia sesión nuevamente.');
    if (outcome.kind === 'idle') throw new UnauthorizedException('La sesión se cerró por inactividad.');
    return {
      response: { access_token: await this.sign(outcome.userId, outcome.sessionId, false), token_type: 'Bearer', expires_in: ACCESS_SECONDS, csrf_token: csrf },
      refresh_cookie: `${outcome.sessionId}.${nextToken}`,
      csrf_cookie: csrf,
    };
  }

  private async rotateRefresh(manager: EntityManager, sessionId: string, presentedHash: string, nextHash: string, ip: string): Promise<RefreshOutcome> {
    const sessions = manager.getRepository(SesionUsuario);
    const history = manager.getRepository(SesionRefreshHash);
    const session = await sessions.findOne({ where: { id: sessionId }, lock: { mode: 'pessimistic_write' } });
    const now = new Date();
    if (!session || session.revocada_en || session.expira_en <= now) throw new UnauthorizedException('La sesión venció.');
    if (isIdle(session, now)) {
      session.revocada_en = now;
      await sessions.save(session);
      await this.auditoria.registrarEventoSeguridad(manager, 'SESION_INACTIVA', { usuarioId: session.usuario_id, ip });
      return { kind: 'idle' };
    }
    if (!safeHashEquals(session.refresh_hash, presentedHash)) {
      const presented = await history.findOneBy({ sesion_id: session.id, refresh_hash: presentedHash });
      if (!presented?.consumida_en) throw new UnauthorizedException('La sesión no es válida.');
      // Dos pestañas que renuevan a la vez: la perdedora presenta el refresh recién rotado. Se
      // tolera una sola vez dentro de la ventana; cualquier otra presentación es robo y revoca.
      const benignRace = session.refresh_anterior_hash !== null && safeHashEquals(session.refresh_anterior_hash, presentedHash)
        && now.getTime() - presented.consumida_en.getTime() <= REFRESH_GRACE_MS;
      if (benignRace) {
        session.refresh_anterior_hash = null;
        await sessions.save(session);
        return { kind: 'concurrent' };
      }
      session.revocada_en = now;
      await sessions.save(session);
      await this.auditoria.registrarEventoSeguridad(manager, 'SESION_REUSO_DETECTADO', { usuarioId: session.usuario_id, ip });
      return { kind: 'replayed' };
    }
    const user = await manager.getRepository(Usuario).findOneBy({ id: session.usuario_id });
    const credential = await manager.getRepository(CredencialUsuario).findOneBy({ usuario_id: session.usuario_id });
    if (!user || user.estado !== UsuarioEstado.ACTIVO || !credential || credential.requiere_cambio) throw new UnauthorizedException('La cuenta no puede renovar la sesión.');
    const previous = await history.findOneBy({ sesion_id: session.id, refresh_hash: presentedHash });
    if (!previous || previous.consumida_en) throw new UnauthorizedException('La sesión no es válida.');
    session.refresh_anterior_hash = session.refresh_hash;
    session.refresh_hash = nextHash;
    await sessions.save(session);
    previous.consumida_en = now;
    await history.save(previous);
    await history.insert({ sesion_id: session.id, refresh_hash: nextHash, consumida_en: null });
    return { kind: 'rotated', userId: user.id, sessionId: session.id };
  }

  /**
   * Revoca la sesión solo si el secreto presentado coincide con su refresh vigente o el anterior:
   * conocer el id de sesión no basta. En cualquier otro caso no hace nada.
   */
  async logout(rawCookie: string, ip: string): Promise<void> {
    const [sessionId, secret] = rawCookie.split('.', 2);
    if (!sessionId || !secret || !UUID.test(sessionId)) return;
    const presented = tokenDigest(secret);
    try {
      await this.dataSource.transaction(async (manager) => {
        const sessions = manager.getRepository(SesionUsuario);
        const session = await sessions.findOne({ where: { id: sessionId }, lock: { mode: 'pessimistic_write' } });
        if (!session || session.revocada_en) return;
        const matches = safeHashEquals(session.refresh_hash, presented)
          || (session.refresh_anterior_hash !== null && safeHashEquals(session.refresh_anterior_hash, presented));
        if (!matches) return;
        session.revocada_en = new Date();
        await sessions.save(session);
        await this.auditoria.registrarEventoSeguridad(manager, 'LOGOUT', { usuarioId: session.usuario_id, ip });
      });
    } catch (error: unknown) { this.rethrowAuthenticationError(error); }
  }

  /**
   * Siempre responde igual. Tras los límites, la búsqueda de la cuenta y la emisión del código se
   * ejecutan fuera de la respuesta para que su duración no revele si el correo existe. Superar
   * el límite por correo descarta la solicitud en silencio.
   */
  async requestPasswordReset(dto: ForgotPasswordDto, ip: string): Promise<void> {
    try {
      const email = dto.email.trim().toLowerCase();
      await this.limiter.enforce(`reset-ip:${ip}`, FORGOT_IP_LIMIT, FORGOT_WINDOW_SECONDS);
      if (await this.limiter.hit(`reset-email:${tokenDigest(email)}`, FORGOT_WINDOW_SECONDS) > FORGOT_EMAIL_LIMIT) return;
      this.track(this.issueRecoveryCode(email, ip));
    } catch (error: unknown) { this.rethrowAuthenticationError(error); }
  }

  private track(work: Promise<void>): void {
    const tracked = work.catch(() => {
      this.logger.error('No se pudo emitir un código de recuperación.');
    }).finally(() => { this.pendingRecoveries.delete(tracked); });
    this.pendingRecoveries.add(tracked);
  }

  private async issueRecoveryCode(email: string, ip: string): Promise<void> {
    const user = await this.dataSource.getRepository(Usuario).findOneBy({ email, estado: UsuarioEstado.ACTIVO });
    if (!user) return;
    const code = generateOneTimeSecret();
    await this.dataSource.transaction(async (manager) => {
      const expiry = new Date(Date.now() + RESET_MS);
      await manager.getRepository(SolicitudRecuperacion).insert({ usuario_id: user.id, codigo_hash: tokenDigest(code), expira_en: expiry, usada_en: null });
      await manager.getRepository(CorreoSalida).save(createEncryptedOutbox(manager, user.id, 'RECUPERACION', code, expiry, this.encryptionKey));
      await this.auditoria.registrarEventoSeguridad(manager, 'RECUPERACION_SOLICITADA', { usuarioId: user.id, ip });
    });
  }

  async resetPassword(dto: ResetPasswordDto, ip: string): Promise<void> {
    try {
      await this.limiter.assertBelow(resetIpFailureKey(ip), RESET_IP_FAILURE_LIMIT);
      try {
        await this.dataSource.transaction(async (manager) => {
          const request = await manager.getRepository(SolicitudRecuperacion).createQueryBuilder('reset')
            .where('reset.codigo_hash = :hash', { hash: tokenDigest(dto.code) })
            .andWhere('reset.usada_en IS NULL').andWhere('reset.expira_en > :now', { now: new Date() })
            .setLock('pessimistic_write').getOne();
          if (!request) throw new UnauthorizedException(INVALID_RESET_CODE);
          const user = await manager.getRepository(Usuario).findOne({ where: { id: request.usuario_id }, lock: { mode: 'pessimistic_write' } });
          if (user?.estado !== UsuarioEstado.ACTIVO) throw new UnauthorizedException(INVALID_RESET_CODE);
          const credential = await manager.getRepository(CredencialUsuario).findOne({ where: { usuario_id: request.usuario_id }, lock: { mode: 'pessimistic_write' } });
          if (!credential) throw new UnauthorizedException(INVALID_RESET_CODE);
          await this.assertPasswordPolicy(manager, user.id, dto.password, user);
          if (credential.password_hash && await verifyPassword(credential.password_hash, dto.password)) {
            throw new ForbiddenException('La nueva contraseña debe ser distinta de la contraseña anterior.');
          }
          credential.requiere_cambio = false;
          credential.temporal_expira_en = null;
          await this.replacePassword(manager, credential, dto.password);
          await this.auditoria.registrarEventoSeguridad(manager, 'RECUPERACION_COMPLETADA', { usuarioId: user.id, ip });
        });
      } catch (error: unknown) {
        if (error instanceof UnauthorizedException) await this.limiter.hit(resetIpFailureKey(ip), RESET_IP_WINDOW_SECONDS);
        throw error;
      }
    } catch (error: unknown) { this.rethrowAuthenticationError(error); }
  }

  /**
   * Guarda la nueva contraseña y, en la misma transacción, revoca las sesiones abiertas e
   * invalida todos los códigos de recuperación pendientes de la cuenta.
   */
  private async replacePassword(manager: EntityManager, credentials: CredencialUsuario, password: string): Promise<void> {
    const now = new Date();
    credentials.password_hash = await hashPassword(password);
    credentials.version_sesion += 1;
    credentials.actualizada_en = now;
    await manager.getRepository(CredencialUsuario).save(credentials);
    await manager.getRepository(SesionUsuario).update({ usuario_id: credentials.usuario_id, revocada_en: IsNull() }, { revocada_en: now });
    await manager.getRepository(SolicitudRecuperacion).update({ usuario_id: credentials.usuario_id, usada_en: IsNull() }, { usada_en: now });
  }

  private async assertPasswordPolicy(manager: EntityManager, userId: string, password: string, knownUser?: Usuario): Promise<void> {
    const user = knownUser ?? await manager.getRepository(Usuario).findOneBy({ id: userId });
    if (!user) throw new UnauthorizedException('La cuenta no es válida.');
    const estudiante = await manager.getRepository(Estudiante).findOneBy({ usuario: { id: userId } });
    const docente = estudiante ? null : await manager.getRepository(Docente).findOneBy({ usuario: { id: userId } });
    const aceptable = cumplePoliticaClave(password, {
      email: user.email, nombres: user.nombres, apellidos: user.apellidos,
      identificadores: [estudiante?.cedula, estudiante?.matricula, docente?.cedula],
    });
    if (!aceptable) throw new BadRequestException(MENSAJE_POLITICA_CLAVE);
  }

  private rethrowAuthenticationError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    this.logger.error('No se pudo completar una operación de autenticación.');
    throw new ServiceUnavailableException('El servicio de autenticación no está disponible.');
  }

  private async sign(userId: string, sessionId: string | undefined, first: boolean): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const token = new SignJWT({ typ: first ? 'first_access' : 'access', ...(sessionId ? { sid: sessionId } : {}) })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.issuer).setAudience(TOKEN_AUDIENCE).setSubject(userId).setIssuedAt(now)
      .setExpirationTime(now + (first ? FIRST_ACCESS_SECONDS : ACCESS_SECONDS));
    return token.sign(this.privateKey);
  }
}

/** `ultima_actividad` nula equivale a una sesión recién creada. */
function isIdle(session: SesionUsuario, now: Date): boolean {
  return session.ultima_actividad !== null && now.getTime() - session.ultima_actividad.getTime() > IDLE_MS;
}

function resetIpFailureKey(ip: string): string {
  return `reset-ip-fail:${ip}`;
}

function safeHashEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Comparación de valores secretos en tiempo constante (cookie y cabecera CSRF). */
export function safeSecretEquals(left: string, right: string): boolean {
  return safeHashEquals(tokenDigest(left), tokenDigest(right));
}
