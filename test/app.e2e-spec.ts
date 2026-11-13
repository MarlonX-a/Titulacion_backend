import type { TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { createE2eTestingModule } from './support/e2e-app.js';
import { configureApplication } from './../src/config/setup-app.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { DatabaseTestingModule } from './database-testing.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await createE2eTestingModule({
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

  it('marca toda respuesta como no almacenable y nosniff, también 401 y 404', async () => {
    for (const [path, status] of [['/', 200], ['/usuarios/me', 401], ['/ruta-inexistente', 404]] as const) {
      const response = await request(app.getHttpServer()).get(path).expect(status);
      expect(response.headers['cache-control'], path).toBe('no-store');
      expect(response.headers['x-content-type-options'], path).toBe('nosniff');
    }
  });

  it('rechaza cuerpos JSON y urlencoded de más de 100 kB con 413', async () => {
    const grande = 'x'.repeat(101 * 1024);
    await request(app.getHttpServer()).post('/auth/login').set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@live.uleam.edu.ec', password: grande })).expect(413);
    await request(app.getHttpServer()).post('/auth/login').set('Content-Type', 'application/x-www-form-urlencoded')
      .send(`email=a%40live.uleam.edu.ec&password=${grande}`).expect(413);
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

  it('documenta exportaciones administrativas y exige autenticación', async () => {
    const docs = await request(app.getHttpServer()).get('/docs-json').expect(200);
    expect(docs.body.paths['/periodos/{periodoId}/exportaciones']).toBeDefined();
    expect(docs.body.paths['/periodos/{periodoId}/exportaciones/{id}/descarga']).toBeDefined();
    await request(app.getHttpServer())
      .post('/periodos/00000000-0000-4000-8000-000000000001/exportaciones')
      .send({ tipo_reporte: 'ESTUDIANTES', formato: 'CSV' })
      .expect(401);
  });

  it('documenta el archivo de períodos y exige autenticación', async () => {
    const docs = await request(app.getHttpServer()).get('/docs-json').expect(200);
    expect(docs.body.paths['/periodos/{id}/archivar']).toBeDefined();
    await request(app.getHttpServer())
      .post('/periodos/00000000-0000-4000-8000-000000000001/archivar')
      .send({ motivo: 'Cierre administrativo' })
      .expect(401);
  });

  afterEach(async () => {
    await app.close();
  });
});
