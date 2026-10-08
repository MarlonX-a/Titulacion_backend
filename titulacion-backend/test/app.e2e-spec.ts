import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApplication } from './../src/config/setup-app.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { DatabaseTestingModule } from './database-testing.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideModule(DatabaseModule)
      .useModule(DatabaseTestingModule)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('documenta el módulo de carga tutorial y protege sus operaciones', async () => {
    const docs = await request(app.getHttpServer()).get('/docs-json').expect(200);
    expect(docs.body.paths['/periodos/{periodoId}/config-carga-tutorial']).toBeDefined();
    expect(docs.body.paths['/periodos/{periodoId}/config-carga-tutorial/efectiva/me']).toBeDefined();
    await request(app.getHttpServer())
      .get('/periodos/00000000-0000-4000-8000-000000000001/config-carga-tutorial')
      .expect(401);
  });

  it('documenta las plantillas PAT y protege su administración', async () => {
    const docs = await request(app.getHttpServer()).get('/docs-json').expect(200);
    expect(docs.body.paths['/periodos/{periodoId}/plantillas-pat']).toBeDefined();
    expect(docs.body.paths['/periodos/{periodoId}/plantillas-pat/vigente']).toBeDefined();
    expect(docs.body.paths['/periodos/{periodoId}/plantillas-pat/vigente/descarga']).toBeDefined();
    await request(app.getHttpServer())
      .get('/periodos/00000000-0000-4000-8000-000000000001/plantillas-pat/vigente')
      .expect(401);
  });

  afterEach(async () => {
    await app.close();
  });
});
