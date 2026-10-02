import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, errors, jwtVerify, type RemoteJWKSet } from 'jose';
import type { AppEnvironment } from '../config/environment.js';
import type { AuthenticatedIdentity } from './authenticated-identity.js';
import { LocalAuthenticationService } from './local/local-authentication.service.js';

@Injectable()
export class AuthenticationService implements OnModuleInit {
  private readonly logger = new Logger(AuthenticationService.name);
  private readonly issuer: string | undefined;
  private readonly audience: string | undefined;
  private readonly keySet: RemoteJWKSet | undefined;

  constructor(
    config: ConfigService<AppEnvironment, true>,
    private readonly localAuthentication: LocalAuthenticationService,
  ) {
    this.issuer = config.get('OIDC_ISSUER', { infer: true });
    this.audience = config.get('OIDC_AUDIENCE', { infer: true });
    const jwksUri = config.get('JWKS_URI', { infer: true });

    if (this.issuer && this.audience && jwksUri) {
      this.keySet = createRemoteJWKSet(new URL(jwksUri), {
        timeoutDuration: 5_000,
        cacheMaxAge: 600_000,
        cooldownDuration: 30_000,
      });
    }
  }

  onModuleInit(): void {
    if (this.localAuthentication.isEnabled()) {
      this.logger.warn(
        'Autenticación local de pruebas activa. No utilices este modo fuera de tu entorno local.',
      );
      return;
    }
    if (!this.isConfigured()) {
      this.logger.warn(
        'Autenticación institucional sin configurar; las rutas protegidas rechazarán solicitudes.',
      );
    }
  }

  isConfigured(): boolean {
    return (
      this.localAuthentication.isEnabled() ||
      Boolean(this.issuer && this.audience && this.keySet)
    );
  }

  async verify(token: string): Promise<AuthenticatedIdentity> {
    if (this.localAuthentication.isEnabled()) {
      return this.localAuthentication.verify(token);
    }
    if (
      !this.isConfigured() ||
      !this.keySet ||
      !this.issuer ||
      !this.audience
    ) {
      throw new ServiceUnavailableException(
        'La autenticación institucional no está configurada.',
      );
    }

    try {
      const { payload } = await jwtVerify(token, this.keySet, {
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
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      if (
        error instanceof errors.JWKSTimeout ||
        error instanceof errors.JWKSInvalid ||
        error instanceof errors.JWKSMultipleMatchingKeys ||
        (error instanceof errors.JOSEError &&
          error.code === 'ERR_JOSE_GENERIC') ||
        !(error instanceof errors.JOSEError)
      ) {
        throw new ServiceUnavailableException(
          'No se pudo consultar el servicio de claves de autenticación.',
        );
      }

      throw new UnauthorizedException('El token no es válido.');
    }
  }
}
