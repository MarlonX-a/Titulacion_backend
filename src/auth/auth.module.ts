import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { UsuariosModule } from '../usuarios/usuarios.module.js';
import { AuthController } from './auth.controller.js';
import { AuthRateLimiterService } from './auth-rate-limiter.service.js';
import { AuthenticationGuard } from './authentication.guard.js';
import { AuthenticationService } from './authentication.service.js';

@Module({
  imports: [UsuariosModule],
  controllers: [AuthController],
  providers: [
    AuthRateLimiterService,
    AuthenticationService,
    { provide: APP_GUARD, useClass: AuthenticationGuard },
  ],
  exports: [AuthenticationService],
})
export class AuthModule {}
