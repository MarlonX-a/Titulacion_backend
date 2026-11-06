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
import { UsuarioRol } from '../src/usuarios/enums/usuario-rol.enum.js';
import { addUsuarioTestRecord, clearUsuarioTestRecords, DatabaseTestingModule, CARRERA_PRUEBA_ID, FACULTAD_PRUEBA_ID } from './database-testing.module.js';

describe('Catálogo académico (e2e)', () => {
  let app: INestApplication<App>;
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    clearUsuarioTestRecords();
    for (const rol of [UsuarioRol.ADMIN, UsuarioRol.DOCENTE, UsuarioRol.ESTUDIANTE]) {
      const user = addUsuarioTestRecord({ email: `${rol.toLowerCase()}-catalogo@live.uleam.edu.ec`, id_externo_sso: `catalogo-${rol}`, rol, nombres: rol, apellidos: 'Prueba' });
      tokens.set(rol, user.id);
    }
    const config = new ConfigService<AppEnvironment, true>({
      NODE_ENV: 'test', PORT: 3000, SWAGGER_ENABLED: true, DB_HOST: '127.0.0.1', DB_PORT: 5432,
      DB_SCHEMA: 'test', DB_USERNAME: 'test_user', DB_PASSWORD: 'test_password', DB_NAME: 'test_database',
      AUTH_ISSUER: 'http://127.0.0.1:3000', AUTH_ORIGINS: [], REDIS_PORT: 6379, SMTP_PORT: 1025, S3_REGION: 'us-east-1',
    });
    const auth = { verifyToken: vi.fn((token: string) => Promise.resolve({ subject: tokens.get(token) ?? '', issuer: 'http://127.0.0.1:3000', firstAccess: false })) };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideModule(DatabaseModule).useModule(DatabaseTestingModule)
      .overrideProvider(ConfigService).useValue(config)
      .overrideProvider(AuthenticationService).useValue(auth)
      .compile();
    app = module.createNestApplication<INestApplication<App>>();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => { await app.close(); clearUsuarioTestRecords(); tokens.clear(); });

  it('GET /facultades exige sesión y responde a cualquier rol con las carreras anidadas', async () => {
    await request(app.getHttpServer()).get('/facultades').expect(401);
    for (const rol of [UsuarioRol.ADMIN, UsuarioRol.DOCENTE, UsuarioRol.ESTUDIANTE]) {
      await request(app.getHttpServer()).get('/facultades').set('Authorization', `Bearer ${rol}`).expect(200).expect(({ body }) => {
        expect(body).toHaveLength(2);
        expect(body.find((f: { id: string }) => f.id === FACULTAD_PRUEBA_ID).carreras).toEqual([{ id: CARRERA_PRUEBA_ID, codigo: 'INGENIERIA_DE_PRUEBA', nombre: 'Ingeniería de Prueba' }]);
      });
    }
  });
});
