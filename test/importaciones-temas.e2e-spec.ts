import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthenticationService } from '../src/auth/authentication.service.js';
import { configureApplication } from '../src/config/setup-app.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { ImportacionesTemasController } from '../src/importaciones/importaciones-temas.controller.js';
import { ImportacionesTemasService } from '../src/importaciones/importaciones-temas.service.js';
import { EstadoTema } from '../src/temas/enums/estado-tema.enum.js';
import { UsuarioRol } from '../src/usuarios/enums/usuario-rol.enum.js';
import { addUsuarioTestRecord, clearUsuarioTestRecords, DatabaseTestingModule } from './database-testing.module.js';
import { testConfigService, tokenAuthenticationMock, createE2eTestingModule } from './support/e2e-app.js';
import { CARRERA_SOFTWARE_ID, DOCENTE_PEREZ_LOOR_ID, LINEA_ID, temasImportHarness } from './support/importaciones-temas-harness.js';
import { temasWorkbook } from './support/temas-workbook.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('Importación de temas (e2e)', () => {
  let app: INestApplication<App>;
  const tokens = new Map<string, string>();
  const harness = temasImportHarness();

  beforeAll(async () => {
    clearUsuarioTestRecords();
    for (const rol of [UsuarioRol.ADMIN, UsuarioRol.DOCENTE]) {
      const user = addUsuarioTestRecord({ email: `${rol.toLowerCase()}-importa-temas@live.uleam.edu.ec`, id_externo_sso: `importa-temas-${rol}`, rol, nombres: rol, apellidos: 'Prueba' });
      tokens.set(rol, user.id);
    }
    // createE2eTestingModule replaces ImportacionesModule (it needs Redis): mount the controller with an in-memory service.
    const module = await createE2eTestingModule({
      imports: [AppModule],
      controllers: [ImportacionesTemasController],
      providers: [{ provide: ImportacionesTemasService, useValue: harness.service }],
    })
      .overrideModule(DatabaseModule).useModule(DatabaseTestingModule)
      .overrideProvider(ConfigService).useValue(testConfigService())
      .overrideProvider(AuthenticationService).useValue(tokenAuthenticationMock(tokens))
      .compile();
    app = module.createNestApplication<INestApplication<App>>();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => { await app.close(); clearUsuarioTestRecords(); tokens.clear(); });

  const as = (rol: UsuarioRol) => ({ Authorization: `Bearer ${rol}` });

  it('valida, resuelve docentes y confirma la importación en el banco de la carrera', async () => {
    const libro = await temasWorkbook([
      [1, 'ALMEIDA EDISON', 'Tema importado A', 'SOFTWARE', 'Observación A'],
      [2, 'PÉREZ', 'Tema importado B', null, null],
    ]);
    const validar = () => request(app.getHttpServer()).post('/importaciones/temas/validar').set(as(UsuarioRol.ADMIN));

    await validar().field('carrera_id', CARRERA_SOFTWARE_ID).field('linea_id', LINEA_ID)
      .attach('archivo', libro, { filename: 'temas.xlsx', contentType: XLSX }).expect(400);
    const preview = await validar().field('carrera_id', CARRERA_SOFTWARE_ID).field('linea_id', LINEA_ID).field('tipo', 'PAREJA')
      .attach('archivo', libro, { filename: 'temas.xlsx', contentType: XLSX }).expect(200);
    expect(preview.body).toMatchObject({ tipo: 'TEMAS', tipo_tema: 'PAREJA', total_filas: 2, listas: 1, pendientes: 1, puede_confirmar: false });
    const id = preview.body.id as string;

    await request(app.getHttpServer()).post(`/importaciones/temas/${id}/confirmar`).set(as(UsuarioRol.ADMIN)).send({}).expect(409);
    await request(app.getHttpServer()).patch(`/importaciones/temas/${id}/docentes`).set(as(UsuarioRol.ADMIN)).send({ resoluciones: [] }).expect(400);
    const resuelta = await request(app.getHttpServer()).patch(`/importaciones/temas/${id}/docentes`).set(as(UsuarioRol.ADMIN))
      .send({ resoluciones: [{ nombre_excel: 'PÉREZ', docente_id: DOCENTE_PEREZ_LOOR_ID }] }).expect(200);
    expect(resuelta.body).toMatchObject({ pendientes: 0, puede_confirmar: true });
    await request(app.getHttpServer()).get(`/importaciones/temas/${id}`).set(as(UsuarioRol.ADMIN)).expect(200)
      .expect(({ body }) => expect(body.filas[1].docente.id).toBe(DOCENTE_PEREZ_LOOR_ID));

    const confirmada = await request(app.getHttpServer()).post(`/importaciones/temas/${id}/confirmar`).set(as(UsuarioRol.ADMIN)).send({}).expect(200);
    expect(confirmada.body).toMatchObject({ estado: 'COMPLETADA', creados: 2, omitidos: 0 });
    const creados = harness.repos.temas.rows.filter((row) => row.lote_importacion_id === confirmada.body.lote_id);
    expect(creados.map((row) => row.estado)).toEqual([EstadoTema.PUBLICADO, EstadoTema.PUBLICADO]);
    await request(app.getHttpServer()).post(`/importaciones/temas/${id}/confirmar`).set(as(UsuarioRol.ADMIN)).send({}).expect(409);
  });

  it('restringe la importación a ADMIN, ofrece la plantilla y valida los parámetros', async () => {
    await request(app.getHttpServer()).get('/importaciones/temas/plantilla').expect(401);
    await request(app.getHttpServer()).get('/importaciones/temas/plantilla').set(as(UsuarioRol.DOCENTE)).expect(403);
    await request(app.getHttpServer()).get('/importaciones/temas/plantilla').set(as(UsuarioRol.ADMIN)).expect(200).expect('Content-Type', /spreadsheetml/);
    await request(app.getHttpServer()).get('/importaciones/temas/no-uuid').set(as(UsuarioRol.ADMIN)).expect(400);
    await request(app.getHttpServer()).get('/importaciones/temas/00000000-0000-4000-8000-000000000000').set(as(UsuarioRol.ADMIN)).expect(404);
    await request(app.getHttpServer()).post('/importaciones/temas/validar').set(as(UsuarioRol.ADMIN))
      .field('carrera_id', CARRERA_SOFTWARE_ID).field('linea_id', LINEA_ID).field('tipo', 'GRUPO').expect(400);
    await request(app.getHttpServer()).post('/importaciones/temas/00000000-0000-4000-8000-000000000000/confirmar').set(as(UsuarioRol.ADMIN)).send({ extra: true }).expect(400);
  });
});
