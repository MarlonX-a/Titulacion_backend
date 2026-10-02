import { createHash, generateKeyPairSync, timingSafeEqual } from 'node:crypto';
import {
  Injectable,
  HttpException,
  HttpStatus,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { errors, jwtVerify, SignJWT } from 'jose';
import type { CryptoKey } from 'jose';
import type { AppEnvironment } from '../../config/environment.js';
import { UsuarioRol } from '../../usuarios/enums/usuario-rol.enum.js';
import { UsuariosService } from '../../usuarios/usuarios.service.js';
import type { LocalLoginDto } from './local-login.dto.js';
import type { AuthenticatedIdentity } from '../authenticated-identity.js';

export const LOCAL_DEMO_USERS = [
  {
    email: 'admin@example.test',
    subject: 'local-demo-admin',
    role: UsuarioRol.ADMIN,
  },
  {
    email: 'docente@example.test',
    subject: 'local-demo-docente',
    role: UsuarioRol.DOCENTE,
  },
  {
    email: 'estudiante@example.test',
    subject: 'local-demo-estudiante',
    role: UsuarioRol.ESTUDIANTE,
  },
] as const;

const ISSUER_PATH = '/auth/local';
const AUDIENCE = 'titulacion-api-local';
const TOKEN_TTL_SECONDS = 900;
const ATTEMPT_WINDOW_MS = 60_000;
const MAX_FAILED_ATTEMPTS = 10;

export interface LocalLoginResult {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

@Injectable()
export class LocalAuthenticationService implements OnModuleInit {
  private readonly enabled: boolean;
  private readonly issuer: string;
  private readonly audience = AUDIENCE;
  private readonly passwordDigest: Buffer | undefined;
  private readonly failedAttempts = new Map<string, number[]>();
  private privateKey: CryptoKey | undefined;
  private publicKey: CryptoKey | undefined;

  constructor(
    config: ConfigService<AppEnvironment, true>,
    private readonly usuarios: UsuariosService,
  ) {
    this.enabled = config.get('AUTH_MODE', { infer: true }) === 'local';
    this.issuer = `http://127.0.0.1:${config.get('PORT', { infer: true })}${ISSUER_PATH}`;
    const password = config.get('LOCAL_AUTH_PASSWORD', { infer: true });
    if (this.enabled && password) {
      this.passwordDigest = createHash('sha256').update(password).digest();
    }
  }

  onModuleInit(): void {
    if (!this.enabled) return;
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKey = pair.privateKey as unknown as CryptoKey;
    this.publicKey = pair.publicKey as unknown as CryptoKey;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async login(
    input: LocalLoginDto,
    clientAddress: string,
  ): Promise<LocalLoginResult> {
    if (!this.enabled) throw new NotFoundException();
    if (!this.passwordDigest || !this.privateKey) {
      throw new UnauthorizedException('No se pudo iniciar sesión.');
    }

    this.enforceAttemptLimit(clientAddress);
    const demoUser = LOCAL_DEMO_USERS.find((user) => user.email === input.email);
    if (!this.passwordMatches(input.password) || !demoUser) {
      this.recordFailure(clientAddress);
      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    }

    await this.usuarios.getActiveByExternalId(demoUser.subject);
    this.failedAttempts.delete(clientAddress);

    const now = Math.floor(Date.now() / 1000);
    const accessToken = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setSubject(demoUser.subject)
      .setIssuedAt(now)
      .setExpirationTime(now + TOKEN_TTL_SECONDS)
      .sign(this.privateKey);

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: TOKEN_TTL_SECONDS,
    };
  }

  async verify(token: string): Promise<AuthenticatedIdentity> {
    if (!this.enabled) {
      throw new UnauthorizedException('El token no es válido.');
    }
    if (!this.publicKey) {
      throw new UnauthorizedException('El token no es válido.');
    }

    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        algorithms: ['RS256'],
        issuer: this.issuer,
        audience: this.audience,
        requiredClaims: ['exp', 'sub'],
      });
      if (typeof payload.sub !== 'string' || payload.sub.trim().length === 0) {
        throw new UnauthorizedException('El token no es válido.');
      }
      return { subject: payload.sub, issuer: this.issuer };
    } catch (error: unknown) {
      if (error instanceof UnauthorizedException) throw error;
      if (error instanceof errors.JOSEError) {
        throw new UnauthorizedException('El token no es válido.');
      }
      throw new UnauthorizedException('El token no es válido.');
    }
  }

  private passwordMatches(password: string): boolean {
    if (!this.passwordDigest) return false;
    const attemptedDigest = createHash('sha256').update(password).digest();
    return timingSafeEqual(this.passwordDigest, attemptedDigest);
  }

  private enforceAttemptLimit(clientAddress: string): void {
    const recent = (this.failedAttempts.get(clientAddress) ?? []).filter(
      (timestamp) => Date.now() - timestamp < ATTEMPT_WINDOW_MS,
    );
    this.failedAttempts.set(clientAddress, recent);
    if (recent.length >= MAX_FAILED_ATTEMPTS) {
      throw new HttpException(
        'Se alcanzó el límite de intentos. Inténtalo nuevamente en un minuto.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private recordFailure(clientAddress: string): void {
    const attempts = this.failedAttempts.get(clientAddress) ?? [];
    attempts.push(Date.now());
    this.failedAttempts.set(clientAddress, attempts);
  }
}
