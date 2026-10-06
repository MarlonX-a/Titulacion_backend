import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiBody, ApiCookieAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AppEnvironment } from '../config/environment.js';
import { Public } from './public.decorator.js';
import { AllowFirstAccess } from './allow-first-access.decorator.js';
import { CurrentIdentity, type AuthenticatedIdentity } from './authenticated-identity.js';
import { AuthenticationService, type AuthenticationResult } from './authentication.service.js';
import { LoginDto } from './dto/login.dto.js';
import { ChangePasswordDto, ForgotPasswordDto, NewPasswordDto, ResetPasswordDto } from './dto/password.dto.js';

const REFRESH_COOKIE = 'titulacion_refresh';
const CSRF_COOKIE = 'titulacion_csrf';

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authentication: AuthenticationService,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesión con correo y contraseña' })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ description: 'Emite un token de acceso y una cookie de renovación HttpOnly.' })
  async login(@Body() dto: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.authentication.login(dto, request.ip ?? 'unknown');
    response.setHeader('Cache-Control', 'no-store');
    if (result.refresh_cookie && result.csrf_cookie) this.setSessionCookies(response, result);
    return result.response;
  }

  @Post('change-initial-password')
  @AllowFirstAccess()
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Establecer contraseña personal durante el primer acceso' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 403, description: 'El token de acceso normal no permite esta operación.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async changeInitialPassword(@CurrentIdentity() identity: AuthenticatedIdentity, @Body() dto: NewPasswordDto): Promise<void> {
    await this.authentication.changeInitialPassword(identity.subject, dto);
  }

  @Post('change-password')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Cambiar contraseña e invalidar sesiones existentes' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(@CurrentIdentity() identity: AuthenticatedIdentity, @Body() dto: ChangePasswordDto): Promise<void> {
    await this.authentication.changePassword(identity.subject, dto);
  }

  @Public()
  @Get('csrf')
  @ApiOperation({ summary: 'Obtener token de protección para renovar o cerrar sesión' })
  csrf(@Req() request: Request, @Res({ passthrough: true }) response: Response): { csrf_token: string } {
    const csrf = cookieValue(request, CSRF_COOKIE) ?? crypto.randomUUID();
    response.setHeader('Set-Cookie', `${CSRF_COOKIE}=${csrf}; Path=/auth; SameSite=Strict${this.secureCookie() ? '; Secure' : ''}`);
    response.setHeader('Cache-Control', 'no-store');
    return { csrf_token: csrf };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('titulacion_refresh')
  @ApiOperation({ summary: 'Renovar token de acceso y rotar cookie de sesión' })
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.validateOriginAndCsrf(request);
    const cookie = cookieValue(request, REFRESH_COOKIE);
    if (!cookie) throw new UnauthorizedException('La sesión no es válida.');
    const result = await this.authentication.refresh(cookie);
    this.setSessionCookies(response, result);
    return result.response;
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth('titulacion_refresh')
  @ApiOperation({ summary: 'Cerrar la sesión actual' })
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    this.validateOriginAndCsrf(request);
    const cookie = cookieValue(request, REFRESH_COOKIE);
    const sessionId = cookie?.split('.', 1)[0];
    if (sessionId) await this.authentication.logout(sessionId);
    this.clearSessionCookies(response);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Solicitar código para restablecer la contraseña' })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() request: Request): Promise<{ message: string }> {
    await this.authentication.requestPasswordReset(dto, request.ip ?? 'unknown');
    return { message: 'Si existe una cuenta activa con ese correo, recibirá instrucciones para recuperar el acceso.' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Restablecer contraseña mediante código de un solo uso' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.authentication.resetPassword(dto);
  }

  @Get('me')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Consultar identidad de la cuenta autenticada' })
  @ApiOkResponse({ description: 'Identidad interna verificada.' })
  getIdentity(@CurrentIdentity() identity: AuthenticatedIdentity): { subject: string; issuer: string } {
    return { subject: identity.subject, issuer: identity.issuer };
  }

  private setSessionCookies(response: Response, result: AuthenticationResult): void {
    const cookies = response.getHeader('Set-Cookie');
    const values = Array.isArray(cookies) ? cookies.map(String) : cookies ? [String(cookies)] : [];
    if (result.refresh_cookie) values.push(`${REFRESH_COOKIE}=${encodeURIComponent(result.refresh_cookie)}; HttpOnly; Path=/auth; Max-Age=28800; SameSite=Strict${this.secureCookie() ? '; Secure' : ''}`);
    if (result.csrf_cookie) values.push(`${CSRF_COOKIE}=${result.csrf_cookie}; Path=/auth; Max-Age=28800; SameSite=Strict${this.secureCookie() ? '; Secure' : ''}`);
    response.setHeader('Set-Cookie', values);
    response.setHeader('Cache-Control', 'no-store');
  }

  private clearSessionCookies(response: Response): void {
    const expired = 'Max-Age=0; Path=/auth; SameSite=Strict';
    response.setHeader('Set-Cookie', [`${REFRESH_COOKIE}=; HttpOnly; ${expired}${this.secureCookie() ? '; Secure' : ''}`, `${CSRF_COOKIE}=; ${expired}${this.secureCookie() ? '; Secure' : ''}`]);
    response.setHeader('Cache-Control', 'no-store');
  }

  private validateOriginAndCsrf(request: Request): void {
    const origin = request.headers.origin;
    const configuredOrigins = this.config.get('AUTH_ORIGINS', { infer: true });
    const defaultOrigin = this.config.get('AUTH_ISSUER', { infer: true });
    if (!origin || !(configuredOrigins.length ? configuredOrigins : [defaultOrigin]).includes(origin)) {
      throw new UnauthorizedException('El origen de la solicitud no está permitido.');
    }
    const cookie = cookieValue(request, CSRF_COOKIE);
    const header = request.headers['x-csrf-token'];
    if (!cookie || typeof header !== 'string' || cookie !== header) {
      throw new UnauthorizedException('La solicitud no superó la validación de origen.');
    }
  }

  private secureCookie(): boolean {
    return this.config.get('NODE_ENV', { infer: true }) === 'production';
  }
}

function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  const pair = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!pair) return undefined;
  try { return decodeURIComponent(pair.slice(name.length + 1)); } catch { return undefined; }
}
