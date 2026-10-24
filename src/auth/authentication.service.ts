import { timingSafeEqual, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ForbiddenException, HttpException, Injectable, Logger, OnModuleInit,
  ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, IsNull } from 'typeorm';
import { argon2id, hash, verify } from 'argon2';
import { SignJWT, importPKCS8, importSPKI, jwtVerify, type CryptoKey } from 'jose';
import type { AppEnvironment } from '../config/environment.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { AuthRateLimiterService } from './auth-rate-limiter.service.js';
import { CorreoSalida } from './entities/correo-salida.entity.js';
import { CredencialUsuario } from './entities/credencial-usuario.entity.js';
import { SesionUsuario } from './entities/sesion-usuario.entity.js';
import { SesionRefreshHash } from './entities/sesion-refresh-hash.entity.js';
import { SolicitudRecuperacion } from './entities/solicitud-recuperacion.entity.js';
import { createEncryptedOutbox, generateOneTimeSecret, readEncryptionKey, tokenDigest } from './credentials.js';
import type { LoginDto } from './dto/login.dto.js';
import type { ChangePasswordDto, ForgotPasswordDto, NewPasswordDto, ResetPasswordDto } from './dto/password.dto.js';
import type { AuthenticatedIdentity } from './authenticated-identity.js';

const ACCESS_SECONDS = 15 * 60;
const FIRST_ACCESS_SECONDS = 10 * 60;
const SESSION_MS = 8 * 60 * 60 * 1000;
const RESET_MS = 30 * 60 * 1000;
const TOKEN_AUDIENCE = 'titulacion-api';
const GENERIC_LOGIN = 'Correo o contraseña incorrectos.';
const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQxMjM0NTY3OA$8P/AGk8BGbfQwIMiWMLOOW0ebK6nPzO6kXGiVDluoYY';

export interface AuthenticationResult {
  response: { access_token: string; token_type: 'Bearer'; expires_in: number; requiere_cambio_clave?: boolean; csrf_token?: string };
  refresh_cookie?: string;
  csrf_cookie?: string;
}

export interface VerifiedIdentity extends AuthenticatedIdentity {
  sessionId?: string;
  firstAccess: boolean;
}

@Injectable()
export class AuthenticationService implements OnModuleInit {
  private readonly logger = new Logger(AuthenticationService.name);
  private readonly issuer: string;
  private privateKey!: CryptoKey;
  private publicKey!: CryptoKey;
  private readonly encryptionKey: string;
  private readonly privateKeyPath?: string;
  private readonly publicKeyPath?: string;

  constructor(
    config: ConfigService<AppEnvironment, true>,
    private readonly dataSource: DataSource,
    private readonly limiter: AuthRateLimiterService,
  ) {
    this.issuer = config.get('AUTH_ISSUER', { infer: true });
    const keyPath = config.get('OUTBOX_ENCRYPTION_KEY_PATH', { infer: true });
    this.encryptionKey = keyPath ? readEncryptionKey(keyPath) : '';
    this.privateKeyPath = config.get('JWT_PRIVATE_KEY_PATH', { infer: true });
    this.publicKeyPath = config.get('JWT_PUBLIC_KEY_PATH', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    try {
      if (this.privateKeyPath && this.publicKeyPath) {
        const privatePem = readFileSync(this.privateKeyPath, 'utf8');
        const publicPem = readFileSync(this.publicKeyPath, 'utf8');
        this.privateKey = await importPKCS8(privatePem, 'RS256');
        this.publicKey = await importSPKI(publicPem, 'RS256');
      } else if (process.env.NODE_ENV === 'test') {
        const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
        this.privateKey = createPrivateKey(pair.privateKey.export({ type: 'pkcs8', format: 'pem' })) as unknown as CryptoKey;
        this.publicKey = createPublicKey(pair.publicKey.export({ type: 'spki', format: 'pem' })) as unknown as CryptoKey;
      } else {
        throw new Error('No se configuraron claves JWT persistentes.');
      }
    } catch {
      this.logger.error('No se pudieron cargar las claves de autenticación.');
      throw new ServiceUnavailableException('La autenticación no está configurada.');
    }
  }

  async login(dto: LoginDto, ip: string): Promise<AuthenticationResult> {
    try {
    await this.enforceLoginLimits(dto.email, ip);
    const users = this.dataSource.getRepository(Usuario);
    const user = await users.findOneBy({ email: dto.email.trim().toLowerCase() });
    const credentials = user ? await this.dataSource.getRepository(CredencialUsuario).findOneBy({ usuario_id: user.id }) : null;
    const passwordHash = credentials?.password_hash ?? DUMMY_HASH;
    const valid = await verify(passwordHash, dto.password).catch(() => false);
    if (!user || !credentials || !credentials.password_hash || !valid) throw new UnauthorizedException(GENERIC_LOGIN);
    if (user.estado !== UsuarioEstado.ACTIVO) throw new ForbiddenException('La cuenta está inactiva.');
    if (credentials.requiere_cambio) {
      if (!credentials.temporal_expira_en || credentials.temporal_expira_en <= new Date()) throw new UnauthorizedException(GENERIC_LOGIN);
      return { response: { access_token: await this.sign(user.id, undefined, true), token_type: 'Bearer', expires_in: FIRST_ACCESS_SECONDS, requiere_cambio_clave: true } };
    }
    const refresh = generateOneTimeSecret();
    const csrf = generateOneTimeSecret();
    const expires = new Date(Date.now() + SESSION_MS);
    const session = await this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(SesionUsuario);
      const created = await sessions.save(sessions.create({
        usuario_id: user.id, refresh_hash: tokenDigest(refresh), refresh_anterior_hash: null, expira_en: expires, revocada_en: null,
      }));
      await manager.getRepository(SesionRefreshHash).insert({ sesion_id: created.id, refresh_hash: tokenDigest(refresh), consumida_en: null });
      return created;
    });
    return {
      response: { access_token: await this.sign(user.id, session.id, false), token_type: 'Bearer', expires_in: ACCESS_SECONDS, csrf_token: csrf },
      refresh_cookie: `${session.id}.${refresh}`,
      csrf_cookie: csrf,
    };
    } catch (error: unknown) {
      this.rethrowAuthenticationError(error);
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
      throw new UnauthorizedException('El token no es válido o la sesión venció.');
    }
    if (typeof payload.sub !== 'string' || typeof payload.typ !== 'string') {
      throw new UnauthorizedException('El token no es válido o la sesión venció.');
    }
    const firstAccess = payload.typ === 'first_access';
    if (payload.typ !== 'access' && !firstAccess) {
      throw new UnauthorizedException('El token no es válido o la sesión venció.');
    }
    try {
      if (firstAccess) {
        const user = await this.dataSource.getRepository(Usuario).findOneBy({ id: payload.sub, estado: UsuarioEstado.ACTIVO });
        if (!user) throw new UnauthorizedException('El token no es válido o la sesión venció.');
        const credential = await this.dataSource.getRepository(CredencialUsuario).findOneBy({ usuario_id: payload.sub });
        if (!credential?.requiere_cambio || !credential.temporal_expira_en || credential.temporal_expira_en <= new Date()) throw new UnauthorizedException('El token no es válido o la sesión venció.');
        return { subject: payload.sub, issuer: this.issuer, firstAccess };
      }
      if (typeof payload.sid !== 'string') throw new UnauthorizedException('El token no es válido o la sesión venció.');
      const session = await this.dataSource.getRepository(SesionUsuario).findOneBy({ id: payload.sid, usuario_id: payload.sub });
      if (!session || session.revocada_en || session.expira_en <= new Date()) throw new UnauthorizedException('El token no es válido o la sesión venció.');
      return { subject: payload.sub, issuer: this.issuer, sessionId: session.id, firstAccess };
    } catch (error: unknown) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.error('No se pudo comprobar una sesión de autenticación.');
      throw new ServiceUnavailableException('El servicio de autenticación no está disponible.');
    }
  }

  async changeInitialPassword(userId: string, dto: NewPasswordDto): Promise<void> {
    try { await this.dataSource.transaction(async (manager) => {
      const credentials = await manager.getRepository(CredencialUsuario).findOne({ where: { usuario_id: userId }, lock: { mode: 'pessimistic_write' } });
      if (!credentials?.requiere_cambio || !credentials.password_hash || !credentials.temporal_expira_en || credentials.temporal_expira_en <= new Date()) throw new UnauthorizedException('La clave temporal venció; solicita otra a ADMIN.');
      if (await verify(credentials.password_hash, dto.password)) throw new ForbiddenException('La nueva contraseña debe ser distinta de la temporal.');
      credentials.password_hash = await hash(dto.password, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
      credentials.requiere_cambio = false;
      credentials.temporal_expira_en = null;
      credentials.version_sesion += 1;
      credentials.actualizada_en = new Date();
      await manager.getRepository(CredencialUsuario).save(credentials);
      await manager.getRepository(SesionUsuario).update({ usuario_id: userId, revocada_en: IsNull() }, { revocada_en: new Date() });
    }); } catch (error: unknown) { this.rethrowAuthenticationError(error); }
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    try { await this.dataSource.transaction(async (manager) => {
      const credentials = await manager.getRepository(CredencialUsuario).findOne({ where: { usuario_id: userId }, lock: { mode: 'pessimistic_write' } });
      if (!credentials?.password_hash || credentials.requiere_cambio || !await verify(credentials.password_hash, dto.current_password)) throw new UnauthorizedException('La contraseña actual no es correcta.');
      if (await verify(credentials.password_hash, dto.password)) throw new ForbiddenException('La nueva contraseña debe ser distinta de la actual.');
      credentials.password_hash = await hash(dto.password, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
      credentials.version_sesion += 1;
      credentials.actualizada_en = new Date();
      await manager.getRepository(CredencialUsuario).save(credentials);
      await manager.getRepository(SesionUsuario).update({ usuario_id: userId, revocada_en: IsNull() }, { revocada_en: new Date() });
    }); } catch (error: unknown) { this.rethrowAuthenticationError(error); }
  }

  async refresh(rawCookie: string): Promise<AuthenticationResult> {
    const [sessionId, refresh] = rawCookie.split('.', 2);
    if (!sessionId || !refresh) throw new UnauthorizedException('La sesión no es válida.');
    const nextToken = generateOneTimeSecret();
    const csrf = generateOneTimeSecret();
    let result: { userId: string; sessionId: string; replayed: boolean };
    try { result = await this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(SesionUsuario);
      const session = await sessions.findOne({ where: { id: sessionId }, lock: { mode: 'pessimistic_write' } });
      if (!session || session.revocada_en || session.expira_en <= new Date()) throw new UnauthorizedException('La sesión venció.');
      const presentedHash = tokenDigest(refresh);
      if (!safeHashEquals(session.refresh_hash, presentedHash)) {
        const presented = await manager.getRepository(SesionRefreshHash).findOneBy({ sesion_id: session.id, refresh_hash: presentedHash });
        if (presented?.consumida_en) {
          session.revocada_en = new Date();
          await sessions.save(session);
          return { userId: session.usuario_id, sessionId: session.id, replayed: true };
        }
        throw new UnauthorizedException('La sesión no es válida.');
      }
      const user = await manager.getRepository(Usuario).findOneBy({ id: session.usuario_id });
      const credential = await manager.getRepository(CredencialUsuario).findOneBy({ usuario_id: session.usuario_id });
      if (!user || user.estado !== UsuarioEstado.ACTIVO || !credential || credential.requiere_cambio) throw new UnauthorizedException('La cuenta no puede renovar la sesión.');
      session.refresh_anterior_hash = session.refresh_hash;
      session.refresh_hash = tokenDigest(nextToken);
      await sessions.save(session);
      const history = manager.getRepository(SesionRefreshHash);
      const previous = await history.findOneBy({ sesion_id: session.id, refresh_hash: presentedHash });
      if (!previous || previous.consumida_en) throw new UnauthorizedException('La sesión no es válida.');
      previous.consumida_en = new Date();
      await history.save(previous);
      await history.insert({ sesion_id: session.id, refresh_hash: session.refresh_hash, consumida_en: null });
      return { userId: user.id, sessionId: session.id, replayed: false };
    }); } catch (error: unknown) { this.rethrowAuthenticationError(error); }
    if (result.replayed) throw new UnauthorizedException('Se detectó la reutilización de una sesión; inicia sesión nuevamente.');
    return {
      response: { access_token: await this.sign(result.userId, result.sessionId, false), token_type: 'Bearer', expires_in: ACCESS_SECONDS, csrf_token: csrf },
      refresh_cookie: `${result.sessionId}.${nextToken}`,
      csrf_cookie: csrf,
    };
  }

  async logout(sessionId: string): Promise<void> {
    try { await this.dataSource.getRepository(SesionUsuario).update({ id: sessionId, revocada_en: IsNull() }, { revocada_en: new Date() }); }
    catch (error: unknown) { this.rethrowAuthenticationError(error); }
  }

  async requestPasswordReset(dto: ForgotPasswordDto, ip: string): Promise<void> {
    try {
    const email = dto.email.trim().toLowerCase();
    await this.limiter.enforce(`reset-ip:${ip}`, 10, 3600);
    await this.limiter.enforce(`reset-email:${tokenDigest(email)}`, 3, 3600);
    const user = await this.dataSource.getRepository(Usuario).findOneBy({ email, estado: UsuarioEstado.ACTIVO });
    if (!user) return;
    const code = generateOneTimeSecret();
    await this.dataSource.transaction(async (manager) => {
      const expiry = new Date(Date.now() + RESET_MS);
      await manager.getRepository(SolicitudRecuperacion).insert({ usuario_id: user.id, codigo_hash: tokenDigest(code), expira_en: expiry, usada_en: null });
      await manager.getRepository(CorreoSalida).save(createEncryptedOutbox(manager, user.id, 'RECUPERACION', code, expiry, this.encryptionKey));
    });
    } catch (error: unknown) { this.rethrowAuthenticationError(error); }
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    try { await this.dataSource.transaction(async (manager) => {
      const rows = await manager.getRepository(SolicitudRecuperacion).createQueryBuilder('reset').where('reset.codigo_hash = :hash', { hash: tokenDigest(dto.code) }).andWhere('reset.usada_en IS NULL').andWhere('reset.expira_en > :now', { now: new Date() }).setLock('pessimistic_write').getOne();
      if (!rows) throw new UnauthorizedException('El código de recuperación no es válido o venció.');
      rows.usada_en = new Date();
      await manager.getRepository(SolicitudRecuperacion).save(rows);
      const credential = await manager.getRepository(CredencialUsuario).findOne({ where: { usuario_id: rows.usuario_id }, lock: { mode: 'pessimistic_write' } });
      if (!credential) throw new UnauthorizedException('No se pudo recuperar la cuenta.');
      if (credential.password_hash && await verify(credential.password_hash, dto.password)) {
        throw new ForbiddenException('La nueva contraseña debe ser distinta de la contraseña anterior.');
      }
      credential.password_hash = await hash(dto.password, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
      credential.requiere_cambio = false;
      credential.temporal_expira_en = null;
      credential.version_sesion += 1;
      credential.actualizada_en = new Date();
      await manager.getRepository(CredencialUsuario).save(credential);
      await manager.getRepository(SesionUsuario).update({ usuario_id: rows.usuario_id, revocada_en: IsNull() }, { revocada_en: new Date() });
    }); } catch (error: unknown) { this.rethrowAuthenticationError(error); }
  }

  private async enforceLoginLimits(email: string, ip: string): Promise<void> {
    await this.limiter.enforce(`login-ip:${ip}`, 10, 60);
    await this.limiter.enforce(`login-email:${tokenDigest(email)}`, 10, 60);
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

function safeHashEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
