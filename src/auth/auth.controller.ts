import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiBody, ApiCookieAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AppEnvironment } from '../config/environment.js';
import { Public } from './public.decorator.js';
import { AllowFirstAccess } from './allow-first-access.decorator.js';
import { CurrentIdentity, type AuthenticatedIdentity } from './authenticated-identity.js';
import { AuthenticationService, REFRESH_CONCURRENTE, safeSecretEquals, type AuthenticationResult } from './authentication.service.js';
import { generateOneTimeSecret } from './credentials.js';
import { LoginDto } from './dto/login.dto.js';
import { ChangePasswordDto, ForgotPasswordDto, NewPasswordDto, ResetPasswordDto } from './dto/password.dto.js';
import { DEVICE_TTL_SECONDS } from './login-throttle.js';

const REFRESH_COOKIE = 'titulacion_refresh';
const CSRF_COOKIE = 'titulacion_csrf';
const DEVICE_COOKIE = 'titulacion_dispositivo';
/** Forma de los valores que emite `generateOneTimeSecret()` (32 bytes en base64url). */
const ISSUED_SECRET = /^[A-Za-z0-9_-]{43}$/;

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
  @ApiOkResponse({ description: 'Emite un token de acceso, una cookie de renovación HttpOnly y la cookie de dispositivo conocido.' })
  @ApiResponse({ status: 401, description: 'Credenciales incorrectas o cuenta no disponible (mensaje genérico).' })
  @ApiResponse({ status: 429, description: 'Demasiados intentos fallidos desde esta IP, para este correo o desde este dispositivo.' })
  async login(@Body() dto: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.authentication.login(dto, clientIp(request), cookieValue(request, this.cookieName(DEVICE_COOKIE)));
    response.setHeader('Cache-Control', 'no-store');
    if (result.refresh_cookie && result.csrf_cookie) this.setSessionCookies(response, result);
    return result.response;
  }

  @Post('change-initial-password')
  @AllowFirstAccess()
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Establecer contraseña personal durante el primer acceso' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 400, description: 'La contraseña no cumple la política (12–128 caracteres, sin datos personales ni patrones comunes).' })
  @ApiResponse({ status: 403, description: 'El token de acceso normal no permite esta operación.' })
  @ApiResponse({ status: 429, description: 'Demasiados intentos para esta cuenta.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async changeInitialPassword(@CurrentIdentity() identity: AuthenticatedIdentity, @Body() dto: NewPasswordDto, @Req() request: Request): Promise<void> {
    await this.authentication.changeInitialPassword(identity.subject, dto, clientIp(request));
  }

  @Post('change-password')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Cambiar contraseña e invalidar sesiones y códigos de recuperación' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 400, description: 'La contraseña no cumple la política (12–128 caracteres, sin datos personales ni patrones comunes).' })
  @ApiResponse({ status: 429, description: 'Demasiados intentos para esta cuenta.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(@CurrentIdentity() identity: AuthenticatedIdentity, @Body() dto: ChangePasswordDto, @Req() request: Request): Promise<void> {
    await this.authentication.changePassword(identity.subject, dto, clientIp(request));
  }

  @Public()
  @Get('csrf')
  @ApiOperation({ summary: 'Obtener token de protección para renovar o cerrar sesión' })
  csrf(@Req() request: Request, @Res({ passthrough: true }) response: Response): { csrf_token: string } {
    // Solo se reutiliza un valor con la forma que emite este servidor; otro valor no se refleja.
    const current = cookieValue(request, this.cookieName(CSRF_COOKIE));
    const csrf = current && ISSUED_SECRET.test(current) ? current : generateOneTimeSecret();
    response.setHeader('Set-Cookie', this.csrfCookie(csrf));
    response.setHeader('Cache-Control', 'no-store');
    return { csrf_token: csrf };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('titulacion_refresh')
  @ApiOperation({ summary: 'Renovar token de acceso y rotar cookie de sesión' })
  @ApiResponse({ status: 401, description: 'Sesión vencida, inactiva, revocada o reutilizada.' })
  @ApiResponse({ status: 409, description: `Otra pestaña renovó la sesión al mismo tiempo (\`code: ${REFRESH_CONCURRENTE}\`); reintentar con la cookie nueva.` })
  @ApiResponse({ status: 429, description: 'Demasiadas renovaciones para esta sesión.' })
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.validateOriginAndCsrf(request);
    const cookie = cookieValue(request, this.cookieName(REFRESH_COOKIE));
    if (!cookie) throw new UnauthorizedException('La sesión no es válida.');
    const result = await this.authentication.refresh(cookie, clientIp(request));
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
    const cookie = cookieValue(request, this.cookieName(REFRESH_COOKIE));
    if (cookie) await this.authentication.logout(cookie, clientIp(request));
    this.clearSessionCookies(response);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Solicitar código para restablecer la contraseña' })
  @ApiResponse({ status: 429, description: 'Demasiadas solicitudes desde esta IP.' })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() request: Request): Promise<{ message: string }> {
    await this.authentication.requestPasswordReset(dto, clientIp(request));
    return { message: 'Si existe una cuenta activa con ese correo, recibirá instrucciones para recuperar el acceso.' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Restablecer contraseña mediante código de un solo uso' })
  @ApiResponse({ status: 400, description: 'La contraseña no cumple la política (12–128 caracteres, sin datos personales ni patrones comunes).' })
  @ApiResponse({ status: 401, description: 'Código no válido, vencido o de una cuenta inactiva.' })
  @ApiResponse({ status: 429, description: 'Demasiados códigos no válidos desde esta IP.' })
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() request: Request): Promise<void> {
    await this.authentication.resetPassword(dto, clientIp(request));
  }

  @Get('me')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Consultar identidad de la cuenta autenticada' })
  @ApiOkResponse({ description: 'Identidad interna verificada.' })
  getIdentity(@CurrentIdentity() identity: AuthenticatedIdentity): { subject: string; issuer: string } {
    return { subject: identity.subject, issuer: identity.issuer };
  }

  /** Cookies de refresh y CSRF sin `Max-Age`: son de sesión y se descartan al cerrar el navegador. */
  private setSessionCookies(response: Response, result: AuthenticationResult): void {
    const cookies = response.getHeader('Set-Cookie');
    const values = Array.isArray(cookies) ? cookies.map(String) : cookies ? [String(cookies)] : [];
    if (result.refresh_cookie) values.push(`${this.cookieName(REFRESH_COOKIE)}=${encodeURIComponent(result.refresh_cookie)}; HttpOnly; Path=/auth; SameSite=Strict${this.secureAttribute()}`);
    if (result.csrf_cookie) values.push(this.csrfCookie(result.csrf_cookie));
    if (result.device_cookie) values.push(`${this.cookieName(DEVICE_COOKIE)}=${result.device_cookie}; HttpOnly; Path=/auth; Max-Age=${DEVICE_TTL_SECONDS}; SameSite=Strict${this.secureAttribute()}`);
    response.setHeader('Set-Cookie', values);
    response.setHeader('Cache-Control', 'no-store');
  }

  /** Borra las cookies de la sesión; la de dispositivo conocido se conserva (no da acceso). */
  private clearSessionCookies(response: Response): void {
    const expired = `Max-Age=0; Path=/auth; SameSite=Strict${this.secureAttribute()}`;
    response.setHeader('Set-Cookie', [`${this.cookieName(REFRESH_COOKIE)}=; HttpOnly; ${expired}`, `${this.cookieName(CSRF_COOKIE)}=; ${expired}`]);
    response.setHeader('Cache-Control', 'no-store');
  }

  private csrfCookie(value: string): string {
    return `${this.cookieName(CSRF_COOKIE)}=${value}; Path=/auth; SameSite=Strict${this.secureAttribute()}`;
  }

  private validateOriginAndCsrf(request: Request): void {
    const origin = request.headers.origin;
    const configuredOrigins = this.config.get('AUTH_ORIGINS', { infer: true });
    const defaultOrigin = this.config.get('AUTH_ISSUER', { infer: true });
    if (!origin || !(configuredOrigins.length ? configuredOrigins : [defaultOrigin]).includes(origin)) {
      throw new UnauthorizedException('El origen de la solicitud no está permitido.');
    }
    const cookie = cookieValue(request, this.cookieName(CSRF_COOKIE));
    const header = request.headers['x-csrf-token'];
    if (!cookie || typeof header !== 'string' || !safeSecretEquals(cookie, header)) {
      throw new UnauthorizedException('La solicitud no superó la validación de origen.');
    }
  }

  /** En production las cookies llevan el prefijo `__Secure-` (exige `Secure` en el navegador). */
  private cookieName(base: string): string {
    return this.secureCookie() ? `__Secure-${base}` : base;
  }

  private secureAttribute(): string {
    return this.secureCookie() ? '; Secure' : '';
  }

  private secureCookie(): boolean {
    return this.config.get('NODE_ENV', { infer: true }) === 'production';
  }
}

/** IP resuelta por Express según TRUST_PROXY; nunca se lee X-Forwarded-For directamente. */
function clientIp(request: Request): string {
  return request.ip ?? request.socket?.remoteAddress ?? 'desconocida';
}

function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  const pair = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!pair) return undefined;
  try { return decodeURIComponent(pair.slice(name.length + 1)); } catch { return undefined; }
}
