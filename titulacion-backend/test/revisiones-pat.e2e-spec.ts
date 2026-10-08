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
import { RevisionPatResultado } from '../src/revisiones-pat/enums/revision-pat-resultado.enum.js';
import { RevisionesPatService } from '../src/revisiones-pat/revisiones-pat.service.js';
import { addUsuarioTestRecord, clearUsuarioTestRecords, DatabaseTestingModule } from './database-testing.module.js';
import { UsuarioRol } from '../src/usuarios/enums/usuario-rol.enum.js';

describe('Revisiones PAT (e2e)', () => {
  let app: INestApplication<App>;
  const identities = new Map<string, string>();
  const admin = { subject: 'pat-admin', rol: UsuarioRol.ADMIN };
  const student = { subject: 'pat-student', rol: UsuarioRol.ESTUDIANTE };
  const teacher = { subject: 'pat-teacher', rol: UsuarioRol.DOCENTE };
  const result = {
    id: '00000000-0000-4000-8000-000000000091', documento_pat_id: '00000000-0000-4000-8000-000000000092',
    revisor_id: '00000000-0000-4000-8000-000000000093', resultado: RevisionPatResultado.OBSERVADO,
    observaciones: 'Corregir la metodología.', fecha_revision: new Date('2026-10-08T12:00:00Z'),
    revisor: { id: '00000000-0000-4000-8000-000000000093', nombres: 'Admin', apellidos: 'Prueba' },
  };
  const revisions = { crear: vi.fn(async () => result), obtener: vi.fn(async () => result) };
  const auth = { verifyToken: vi.fn(async (token: string) => ({ subject: identities.get(token) ?? '', issuer: 'http://127.0.0.1:3000', firstAccess: false })) };

  beforeAll(async () => {
    clearUsuarioTestRecords();
    for (const identity of [admin, student, teacher]) {
      const user = addUsuarioTestRecord({ email: `${identity.subject}@example.test`, id_externo_sso: identity.subject, rol: identity.rol, nombres: identity.rol, apellidos: 'Pruebas' });
      identities.set(identity.subject, user.id);
    }
    const config = new ConfigService<AppEnvironment, true>({
      NODE_ENV: 'test', PORT: 3000, SWAGGER_ENABLED: true,
      DB_HOST: '127.0.0.1', DB_PORT: 5432, DB_SCHEMA: 'test', DB_USERNAME: 'test_user', DB_PASSWORD: 'test_password', DB_NAME: 'test_database',
      AUTH_ISSUER: 'http://127.0.0.1:3000', AUTH_ORIGINS: [], REDIS_PORT: 6379, SMTP_PORT: 1025, S3_REGION: 'us-east-1',
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideModule(DatabaseModule).useModule(DatabaseTestingModule)
      .overrideProvider(ConfigService).useValue(config)
      .overrideProvider(AuthenticationService).useValue(auth)
      .overrideProvider(RevisionesPatService).useValue(revisions)
      .compile();
    app = module.createNestApplication<INestApplication<App>>();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => { await app.close(); clearUsuarioTestRecords(); identities.clear(); });

  const path = '/periodos/00000000-0000-4000-8000-000000000010/asignaciones-tema/00000000-0000-4000-8000-000000000011/documentos-pat/00000000-0000-4000-8000-000000000092/revision';
  const authHeader = (subject: string) => ({ Authorization: `Bearer ${subject}` });

  it('permite registrar y consultar revisión con la salida documentada', async () => {
    await request(app.getHttpServer()).post(path).set(authHeader(admin.subject)).send({ resultado: 'OBSERVADO', observaciones: '  Corregir la metodología.  ' }).expect(201).expect(({ body }) => expect(body).toMatchObject({ resultado: 'OBSERVADO', observaciones: 'Corregir la metodología.' }));
    await request(app.getHttpServer()).get(path).set(authHeader(student.subject)).expect(200).expect(({ body }) => expect(body).toMatchObject({ resultado: 'OBSERVADO', revisor: { nombres: 'Admin' } }));
    expect(revisions.crear).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.any(String), expect.objectContaining({ resultado: 'OBSERVADO', observaciones: 'Corregir la metodología.' }), expect.objectContaining({ rol: UsuarioRol.ADMIN }), expect.anything());
  });

  it('valida observaciones y rechaza campos adicionales antes del servicio', async () => {
    await request(app.getHttpServer()).post(path).set(authHeader(admin.subject)).send({ resultado: 'RECHAZADO' }).expect(400);
    await request(app.getHttpServer()).post(path).set(authHeader(admin.subject)).send({ resultado: 'APROBADO', responsable_id: 'forjado' }).expect(400);
    expect(revisions.crear).toHaveBeenCalledTimes(1);
  });

  it('reserva la creación a ADMIN y la lectura a roles autorizados', async () => {
    await request(app.getHttpServer()).post(path).set(authHeader(student.subject)).send({ resultado: 'APROBADO' }).expect(403);
    await request(app.getHttpServer()).get(path).set(authHeader(teacher.subject)).expect(200);
    await request(app.getHttpServer()).get(path).set({ Authorization: 'Bearer unknown-token' }).expect(403);
  });

  it('expone las rutas de revisión en Swagger', async () => {
    const response = await request(app.getHttpServer()).get('/docs-json').expect(200);
    expect(response.body.paths).toHaveProperty('/periodos/{periodoId}/asignaciones-tema/{asignacionId}/documentos-pat/{documentoId}/revision');
  });
});
