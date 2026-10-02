import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { UsuariosModule } from '../usuarios/usuarios.module.js';
import { AuthController } from './auth.controller.js';
import { LocalAuthController } from './local/local-auth.controller.js';
import { LocalAuthenticationService } from './local/local-authentication.service.js';
import { AuthenticationGuard } from './authentication.guard.js';
import { AuthenticationService } from './authentication.service.js';

@Module({
  imports: [UsuariosModule],
  controllers: [AuthController, LocalAuthController],
  providers: [
    LocalAuthenticationService,
    AuthenticationService,
    { provide: APP_GUARD, useClass: AuthenticationGuard },
  ],
  exports: [AuthenticationService],
})
export class AuthModule {}
