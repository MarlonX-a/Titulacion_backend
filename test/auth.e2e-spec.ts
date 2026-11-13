import { ConflictException, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { createE2eTestingModule } from './support/e2e-app.js';
import { AuthenticationService } from '../src/auth/authentication.service.js';
import { configureApplication } from '../src/config/setup-app.js';
import type { AppEnvironment } from '../src/config/environment.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { UsuariosService } from '../src/usuarios/usuarios.service.js';
import { DatabaseTestingModule } from './database-testing.module.js';

describe('Autenticación de cuenta propia (e2e)', () => {
  let app: INestApplication<App>;
  const authentication = {
    login: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    verifyToken: vi.fn(),
    changeInitialPassword: vi.fn(),
    changePassword: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
  };
  const identityId = '00000000-0000-4000-8000-000000000001';

  beforeAll(async () => {
    const config = new ConfigService<AppEnvironment, true>({
      NODE_ENV: 'test', PORT: 3000, SWAGGER_ENABLED: true,
      DB_HOST: '127.0.0.1', DB_PORT: 5432, DB_SCHEMA: 'test', DB_USERNAME: 'test', DB_PASSWORD: 'test', DB_NAME: 'test',
      AUTH_ISSUER: 'http://127.0.0.1:3000', AUTH_ORIGINS: [], REDIS_PORT: 6379, SMTP_PORT: 1025, S3_REGION: 'us-east-1',
    });
    authentication.login.mockResolvedValue({
      response: { access_token: 'access-token-test', token_type: 'Bearer', expires_in: 900 },
      refresh_cookie: 'session.refresh-test', csrf_cookie: 'csrf-test', device_cookie: 'device-test',
    });
    authentication.refresh.mockResolvedValue({
      response: { access_token: 'refreshed-access-test', token_type: 'Bearer', expires_in: 900 },
      refresh_cookie: 'session.next-refresh', csrf_cookie: 'next-csrf',
    });
    authentication.verifyToken.mockResolvedValue({ subject: identityId, issuer: 'http://127.0.0.1:3000', firstAccess: true });
    const module = await createE2eTestingModule({ imports: [AppModule] })
      .overrideModule(DatabaseModule).useModule(DatabaseTestingModule)
      .overrideProvider(ConfigService).useValue(config)
      .overrideProvider(AuthenticationService).useValue(authentication)
      .overrideProvider(UsuariosService).useValue({ getActiveById: vi.fn(), recordAccess: vi.fn() })
      .compile();
    app = module.createNestApplication<INestApplication<App>>();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => { await app.close(); });

  beforeEach(() => vi.clearAllMocks());

  it('normaliza el correo, conserva la contraseña y emite cookie HttpOnly sin caché', async () => {
    const response = await request(app.getHttpServer()).post('/auth/login').send({ email: ' ADMIN@ULEAM.EDU.EC ', password: 'exact password 123' }).expect(200);
    expect(authentication.login).toHaveBeenCalledWith({ email: 'admin@uleam.edu.ec', password: 'exact password 123' }, expect.any(String), undefined);
    expect(response.body).toMatchObject({ token_type: 'Bearer', expires_in: 900 });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(String(response.headers['set-cookie'])).toContain('HttpOnly');
  });

  it('rechaza contraseñas vacías y propiedades adicionales', async () => {
    await request(app.getHttpServer()).post('/auth/login').send({ email: 'admin@uleam.edu.ec', password: '' }).expect(400);
    await request(app.getHttpServer()).post('/auth/login').send({ email: 'admin@uleam.edu.ec', password: 'password-larga-123', rol: 'ADMIN' }).expect(400);
    expect(authentication.login).not.toHaveBeenCalled();
  });

  it('responde uniformemente a recuperación sin revelar si existe el correo', async () => {
    const response = await request(app.getHttpServer()).post('/auth/forgot-password').send({ email: 'unknown@live.uleam.edu.ec' }).expect(202);
    expect(response.body.message).toContain('Si existe una cuenta activa');
  });

  it('limita el token temporal de primer acceso al cambio de contraseña', async () => {
    const initialPassword = randomBytes(18).toString('base64url');
    await request(app.getHttpServer()).get('/usuarios').set('Authorization', 'Bearer first-access-token').expect(403);
    await request(app.getHttpServer()).post('/auth/change-initial-password').set('Authorization', 'Bearer first-access-token').send({ password: initialPassword }).expect(204);
    expect(authentication.changeInitialPassword).toHaveBeenCalledWith(identityId, { password: initialPassword }, expect.any(String));
  });

  it('renueva sesión solo con origen permitido y CSRF coincidente', async () => {
    const csrf = await request(app.getHttpServer()).get('/auth/csrf').expect(200);
    expect(csrf.headers['cache-control']).toBe('no-store');
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', 'titulacion_refresh=session.refresh').set('Cookie', String(csrf.headers['set-cookie'])).expect(401);
    const response = await request(app.getHttpServer()).post('/auth/refresh')
      .set('Origin', 'http://127.0.0.1:3000')
      .set('Cookie', [`titulacion_refresh=session.refresh`, `titulacion_csrf=${csrf.body.csrf_token}`])
      .set('X-CSRF-Token', csrf.body.csrf_token)
      .expect(200);
    expect(authentication.refresh).toHaveBeenCalledWith('session.refresh', expect.any(String));
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('pasa la cookie de dispositivo al servicio y emite cookies de sesión sin Max-Age', async () => {
    const response = await request(app.getHttpServer()).post('/auth/login').set('Cookie', 'titulacion_dispositivo=equipo-conocido')
      .send({ email: 'admin@uleam.edu.ec', password: 'exact password 123' }).expect(200);
    expect(authentication.login).toHaveBeenCalledWith(expect.anything(), expect.any(String), 'equipo-conocido');
    const cookies = (response.headers['set-cookie'] as unknown as string[]);
    const session = cookies.filter((line) => /^titulacion_(refresh|csrf)=/.test(line));
    expect(session).toHaveLength(2);
    for (const line of session) expect(line).not.toMatch(/max-age|expires/i);
    expect(cookies.find((line) => line.startsWith('titulacion_dispositivo='))).toContain('HttpOnly; Path=/auth; Max-Age=7776000; SameSite=Strict');
  });

  it('exige 12 caracteres en una contraseña nueva', async () => {
    await request(app.getHttpServer()).post('/auth/reset-password').send({ code: 'c'.repeat(43), password: 'Ab3$efgh-1' }).expect(400);
    expect(authentication.resetPassword).not.toHaveBeenCalled();
  });

  it('GET /auth/csrf no refleja un valor malformado y conserva uno emitido por el servidor', async () => {
    const malformed = await request(app.getHttpServer()).get('/auth/csrf').set('Cookie', 'titulacion_csrf=valor-del-atacante').expect(200);
    expect(malformed.body.csrf_token).not.toBe('valor-del-atacante');
    expect(malformed.body.csrf_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const valid = randomBytes(32).toString('base64url');
    const kept = await request(app.getHttpServer()).get('/auth/csrf').set('Cookie', 'titulacion_csrf=' + valid).expect(200);
    expect(kept.body.csrf_token).toBe(valid);
  });

  it('responde 409 con el código REFRESH_CONCURRENTE cuando otra pestaña renovó la sesión', async () => {
    authentication.refresh.mockRejectedValueOnce(new ConflictException({ statusCode: 409, code: 'REFRESH_CONCURRENTE', message: 'La sesión se renovó en otra pestaña; vuelve a intentarlo.' }));
    const csrf = randomBytes(32).toString('base64url');
    const response = await request(app.getHttpServer()).post('/auth/refresh').set('Origin', 'http://127.0.0.1:3000')
      .set('Cookie', ['titulacion_refresh=session.refresh', 'titulacion_csrf=' + csrf]).set('X-CSRF-Token', csrf).expect(409);
    expect(response.body.code).toBe('REFRESH_CONCURRENTE');
  });

  it('logout entrega la cookie completa al servicio y siempre borra las cookies de sesión', async () => {
    const csrf = randomBytes(32).toString('base64url');
    const response = await request(app.getHttpServer()).post('/auth/logout').set('Origin', 'http://127.0.0.1:3000')
      .set('Cookie', ['titulacion_refresh=session.secreto', 'titulacion_csrf=' + csrf]).set('X-CSRF-Token', csrf).expect(204);
    expect(authentication.logout).toHaveBeenCalledWith('session.secreto', expect.any(String));
    expect(String(response.headers['set-cookie'])).toContain('titulacion_refresh=; HttpOnly; Max-Age=0');
  });
});
