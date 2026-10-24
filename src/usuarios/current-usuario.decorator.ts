import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { Usuario } from './entities/usuario.entity.js';

export const CurrentUsuario = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Usuario => {
    const request = context.switchToHttp().getRequest<{ usuario: Usuario }>();
    return request.usuario;
  },
);
