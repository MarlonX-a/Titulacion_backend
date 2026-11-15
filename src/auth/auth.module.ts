import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { RateLimitGuard } from '../common/http/rate-limit.guard.js';
import { NotificacionesModule } from '../notificaciones/notificaciones.module.js';
import { UsuariosModule } from '../usuarios/usuarios.module.js';
import { AuthController } from './auth.controller.js';
import { AuthRateLimiterService } from './auth-rate-limiter.service.js';
import { AuthenticationGuard } from './authentication.guard.js';
import { AuthenticationService } from './authentication.service.js';
import { PrimerAccesoService } from './primer-acceso.service.js';

@Module({
  imports: [UsuariosModule, AuditoriaModule, NotificacionesModule],
  controllers: [AuthController],
  providers: [
    AuthRateLimiterService,
    AuthenticationService,
    PrimerAccesoService,
    // El orden importa: los guards globales se ejecutan en el orden de registro, y
    // RateLimitGuard necesita el usuario que deja AuthenticationGuard en la solicitud.
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [AuthenticationService, AuthRateLimiterService],
})
export class AuthModule {}
