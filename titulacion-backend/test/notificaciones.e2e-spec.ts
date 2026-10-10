import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuthenticationService } from '../src/auth/authentication.service.js';
import type { AppEnvironment } from '../src/config/environment.js';
import { configureApplication } from '../src/config/setup-app.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { NotificacionesService } from '../src/notificaciones/notificaciones.service.js';
import { UsuarioRol } from '../src/usuarios/enums/usuario-rol.enum.js';
import { addUsuarioTestRecord, clearUsuarioTestRecords, DatabaseTestingModule } from './database-testing.module.js';

describe('Notificaciones (e2e)', () => {
  let app: INestApplication<App>;
  const subject = 'notification-admin';
  const id = '00000000-0000-4000-8000-000000000099';
  const tokenSubjects = new Map([[subject, '']]);
  const result = { id, tipo: 'TEMA_ASIGNADO', titulo: 'Tema asignado', mensaje: 'Consulta el sistema.', entidad_tipo: 'asignacion_tema', entidad_id: id, canal: 'EN_APP', leida: true, fecha_creacion: new Date(), fecha_envio: new Date() };
  const service = {
    marcarLeida: vi.fn(async () => result),
    listar: vi.fn(async (_actor, query) => ({ data: [], total: 0, page: query.page, limit: query.limit })),
    contador: vi.fn(async () => ({ total: 0 })),
  };

  beforeAll(async () => {
    clearUsuarioTestRecords();
    const user = addUsuarioTestRecord({ email: 'notification-admin@example.test', id_externo_sso: subject, rol: UsuarioRol.ADMIN, nombres: 'Admin', apellidos: 'Prueba' });
    tokenSubjects.set(subject, user.id);
    const config = new ConfigService<AppEnvironment, true>({
      NODE_ENV: 'test', PORT: 3000, SWAGGER_ENABLED: true, DB_HOST: '127.0.0.1', DB_PORT: 5432,
      DB_SCHEMA: 'test', DB_USERNAME: 'test_user', DB_PASSWORD: 'test_password', DB_NAME: 'test_database',
      AUTH_ISSUER: 'http://127.0.0.1:3000', AUTH_ORIGINS: [], REDIS_PORT: 6379, SMTP_PORT: 1025, S3_REGION: 'us-east-1',
    });
    const auth = { verifyToken: vi.fn(async (token: string) => ({ subject: tokenSubjects.has(token) ? user.id : '', issuer: 'http://127.0.0.1:3000', firstAccess: false })) };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideModule(DatabaseModule).useModule(DatabaseTestingModule)
      .overrideProvider(ConfigService).useValue(config)
      .overrideProvider(AuthenticationService).useValue(auth)
      .overrideProvider(NotificacionesService).useValue(service)
      .compile();
    app = module.createNestApplication<INestApplication<App>>();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => { await app.close(); clearUsuarioTestRecords(); tokenSubjects.clear(); });

  it('marca un aviso propio como leído con HTTP 200 e idempotencia de dominio', async () => {
    await request(app.getHttpServer()).post(`/notificaciones/${id}/leer`).set('Authorization', `Bearer ${subject}`).expect(200).expect(({ body }) => expect(body).toMatchObject({ id, leida: true }));
    expect(service.marcarLeida).toHaveBeenCalledTimes(1);
  });

  it('rechaza cuerpos adicionales y tipos fuera del catálogo', async () => {
    await request(app.getHttpServer()).post(`/notificaciones/${id}/leer`).set('Authorization', `Bearer ${subject}`).send({ leida: false }).expect(400);
    await request(app.getHttpServer()).get('/notificaciones?tipo=INVENTADO').set('Authorization', `Bearer ${subject}`).expect(400);
    expect(service.marcarLeida).toHaveBeenCalledTimes(1);
    expect(service.listar).not.toHaveBeenCalled();
  });

  it('publica el catálogo extendido en Swagger', async () => {
    await request(app.getHttpServer()).get('/docs-json').expect(200).expect(({ body }) => {
      expect(body.paths).toHaveProperty('/notificaciones/{id}/leer');
      const tipo = body.paths['/notificaciones'].get.parameters.find((parameter: { name: string }) => parameter.name === 'tipo');
      expect(tipo.schema.enum).toContain('INVITACION_RECIBIDA');
    });
  });
});
