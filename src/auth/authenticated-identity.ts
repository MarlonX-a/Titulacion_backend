import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export interface AuthenticatedIdentity {
  subject: string;
  issuer: string;
  sessionId?: string;
  firstAccess?: boolean;
}

export const CurrentIdentity = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedIdentity => {
    const request = context.switchToHttp().getRequest<{
      user: AuthenticatedIdentity;
    }>();

    return request.user;
  },
);
