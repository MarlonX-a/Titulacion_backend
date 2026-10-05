import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { INestApplication } from '@nestjs/common';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import type { AppEnvironment } from '../src/config/environment.js';
import { configureApplication } from '../src/config/setup-app.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { GruposService } from '../src/grupos/grupos.service.js';
import { InvitacionesService } from '../src/invitaciones/invitaciones.service.js';
import { UsuarioRol } from '../src/usuarios/enums/usuario-rol.enum.js';
import { addUsuarioTestRecord, clearUsuarioTestRecords, DatabaseTestingModule } from './database-testing.module.js';

const password = 'local-test-password-long-enough';
const roles = [
  { email: 'admin@example.test', subject: 'local-demo-admin', role: UsuarioRol.ADMIN },
  { email: 'docente@example.test', subject: 'local-demo-docente', role: UsuarioRol.DOCENTE },
  { email: 'estudiante@example.test', subject: 'local-demo-estudiante', role: UsuarioRol.ESTUDIANTE },
  { email: 'estudiante2@example.test', subject: 'local-demo-estudiante2', role: UsuarioRol.ESTUDIANTE },
] as const;

describe('Grupos e invitaciones (e2e)', () => {
  let app: INestApplication<App>;
  let tokens: Record<string, string>;
  const groupService = {
    create: vi.fn(async () => ({ id: '00000000-0000-4000-8000-000000000001' })),
    list: vi.fn(async () => ({ data: [], total: 0, page: 1, limit: 20 })),
    getMine: vi.fn(async () => ({ id: '00000000-0000-4000-8000-000000000001' })),
    getById: vi.fn(async () => ({ id: '00000000-0000-4000-8000-000000000001' })),
  };
  const invitationService = {
    create: vi.fn(async () => ({ id: '00000000-0000-4000-8000-000000000002' })),
    listSent: vi.fn(async () => ({ data: [], total: 0, page: 1, limit: 20 })),
    listReceived: vi.fn(async () => ({ data: [], total: 0, page: 1, limit: 20 })),
    accept: vi.fn(async () => ({ id: '00000000-0000-4000-8000-000000000002' })),
    reject: vi.fn(async () => ({ id: '00000000-0000-4000-8000-000000000002' })),
    cancel: vi.fn(async () => ({ id: '00000000-0000-4000-8000-000000000002' })),
  };

  beforeAll(async () => {
    clearUsuarioTestRecords();
    for (const user of roles) addUsuarioTestRecord({ email: user.email, id_externo_sso: user.subject, rol: user.role, nombres: user.role, apellidos: 'Pruebas' });
    const config = new ConfigService<AppEnvironment, true>({
      NODE_ENV: 'test', AUTH_MODE: 'local', PORT: 3000, SWAGGER_ENABLED: true,
      DB_HOST: '127.0.0.1', DB_PORT: 5432, DB_SCHEMA: 'local_demo', DB_USERNAME: 'test_user',
      DB_PASSWORD: 'test_password', DB_NAME: 'test_database', LOCAL_AUTH_PASSWORD: password,
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideModule(DatabaseModule).useModule(DatabaseTestingModule)
      .overrideProvider(ConfigService).useValue(config)
      .overrideProvider(GruposService).useValue(groupService)
      .overrideProvider(InvitacionesService).useValue(invitationService)
      .compile();
    app = module.createNestApplication<INestApplication<App>>();
    configureApplication(app);
    await app.init();
    tokens = {};
    for (const user of roles) {
      const response = await request(app.getHttpServer()).post('/auth/local/login').send({ email: user.email, password }).expect(200);
      const tokenKey = user.email === 'estudiante2@example.test' ? 'student2' : user.role === UsuarioRol.ESTUDIANTE ? 'student' : user.role.toLowerCase();
      tokens[tokenKey] = response.body.access_token as string;
    }
  });

  afterAll(async () => {
    await app.close();
    clearUsuarioTestRecords();
  });

  it('permite crear al estudiante, valida body estricto y rechaza al docente', async () => {
    const period = '00000000-0000-4000-8000-000000000010';
    await request(app.getHttpServer()).post(`/periodos/${period}/grupos`).set('Authorization', `Bearer ${tokens.student}`).send({ nombre: ' Grupo 1 ' }).expect(201);
    expect(groupService.create).toHaveBeenCalledWith(period, expect.objectContaining({ rol: UsuarioRol.ESTUDIANTE }), { nombre: 'Grupo 1' }, expect.anything());
    await request(app.getHttpServer()).post(`/periodos/${period}/grupos`).set('Authorization', `Bearer ${tokens.student}`).send({ nombre: 'Grupo 2', estado: 'ACTIVO' }).expect(400);
    await request(app.getHttpServer()).post(`/periodos/${period}/grupos`).set('Authorization', `Bearer ${tokens.docente}`).send({ nombre: 'Grupo 3' }).expect(403);
  });

  it('permite a ADMIN consultar y bloquea filtros de grupo al estudiante', async () => {
    const period = '00000000-0000-4000-8000-000000000010';
    await request(app.getHttpServer()).get(`/periodos/${period}/grupos`).set('Authorization', `Bearer ${tokens.admin}`).expect(200);
    await request(app.getHttpServer()).get(`/periodos/${period}/grupos`).set('Authorization', `Bearer ${tokens.student}`).expect(403);
  });

  it('valida invitaciones y exige acciones sin campos adicionales', async () => {
    const period = '00000000-0000-4000-8000-000000000010';
    const group = '00000000-0000-4000-8000-000000000011';
    const invite = '00000000-0000-4000-8000-000000000012';
    await request(app.getHttpServer()).post(`/periodos/${period}/grupos/${group}/invitaciones`).set('Authorization', `Bearer ${tokens.student}`).send({ estudiante_destino_id: '00000000-0000-4000-8000-000000000013' }).expect(201);
    await request(app.getHttpServer()).post(`/periodos/${period}/grupos/${group}/invitaciones`).set('Authorization', `Bearer ${tokens.student}`).send({ estudiante_destino_id: 'not-a-uuid' }).expect(400);
    await request(app.getHttpServer()).post(`/periodos/${period}/invitaciones/${invite}/aceptar`).set('Authorization', `Bearer ${tokens.student2}`).send({ rol: 'ADMIN' }).expect(400);
    await request(app.getHttpServer()).get(`/periodos/${period}/invitaciones/me`).set('Authorization', `Bearer ${tokens.student2}`).expect(200);
  });
});
