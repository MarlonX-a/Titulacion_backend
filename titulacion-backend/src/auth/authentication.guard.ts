import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthenticatedIdentity } from './authenticated-identity.js';
import { AuthenticationService } from './authentication.service.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { ALLOW_UNREGISTERED_IDENTITY } from './allow-unregistered-identity.decorator.js';
import { REQUIRED_ROLES } from '../common/roles.decorator.js';
import type { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuariosService } from '../usuarios/usuarios.service.js';

type AuthenticatedRequest = Request & {
  user: AuthenticatedIdentity;
  usuario: Usuario;
};

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authentication: AuthenticationService,
    private readonly usuarios: UsuariosService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const match = authorization?.match(/^Bearer ([^\s]+)$/i);

    if (!match) {
      throw new UnauthorizedException('Se requiere un token Bearer válido.');
    }

    request.user = await this.authentication.verify(match[1]);

    const allowUnregisteredIdentity = this.reflector.getAllAndOverride<boolean>(
      ALLOW_UNREGISTERED_IDENTITY,
      [context.getHandler(), context.getClass()],
    );
    if (allowUnregisteredIdentity) return true;

    const usuario = await this.usuarios.getActiveByExternalId(
      request.user.subject,
    );
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_ROLES,
      [context.getHandler(), context.getClass()],
    );

    if (requiredRoles?.length && !requiredRoles.includes(usuario.rol)) {
      throw new ForbiddenException(
        'El rol de la cuenta no permite esta acción.',
      );
    }

    usuario.ultimo_acceso = await this.usuarios.recordAccess(usuario.id);
    request.usuario = usuario;
    return true;
  }
}
