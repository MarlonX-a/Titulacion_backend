import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuthenticationService } from '../src/auth/authentication.service.js';
import { configureApplication } from '../src/config/setup-app.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { DocumentosPatService } from '../src/documentos-pat/documentos-pat.service.js';
import { GeneracionesPatService } from '../src/generaciones-pat/generaciones-pat.service.js';
import { UsuarioRol } from '../src/usuarios/enums/usuario-rol.enum.js';
import { addUsuarioTestRecord, clearUsuarioTestRecords, DatabaseTestingModule } from './database-testing.module.js';
import { createE2eTestingModule, testConfigService, tokenAuthenticationMock } from './support/e2e-app.js';

describe('PAT del estudiante /pat/me (e2e)', () => {
  let app: INestApplication<App>;
  const tokens = new Map<string, string>();
  const base = '/periodos/00000000-0000-4000-8000-000000000010/asignaciones-tema/00000000-0000-4000-8000-000000000011/pat/me';
  const generacionId = '00000000-0000-4000-8000-000000000012';
  const resumen = { asignacion_tema_id: '00000000-0000-4000-8000-000000000011', estudiante_id: 'e', automaticos: { curso: { valor: 'Octavo', fuente: 'ESTUDIANTE_NIVEL' } }, editables: { personal: {}, contenido: {} }, pendientes: ['confirma_problematica'], listo_para_generar: false, tutores_propuestos: { tutor_vigente: null, data: [] } };
  const generaciones = {
    resumen: vi.fn(async () => resumen),
    listar: vi.fn(async () => ({ data: [{ id: generacionId, estado: 'LISTO', ciclo: 1 }], total: 1 })),
    actualizarContenido: vi.fn(async () => ({ contenido: {}, pendientes: [] })),
    reintentar: vi.fn(async () => ({ id: generacionId, estado: 'EN_COLA' })),
    solicitar: vi.fn(async () => ({ id: generacionId, estado: 'EN_COLA' })),
  };
  const documentos = { entregarGenerada: vi.fn(async () => ({ id: 'doc', origen: 'GENERADO', firmado: false, version: 1 })) };
  const as = (rol: string) => ({ Authorization: `Bearer ${rol}` });

  beforeAll(async () => {
    clearUsuarioTestRecords();
    for (const rol of [UsuarioRol.ESTUDIANTE, UsuarioRol.ADMIN, UsuarioRol.DOCENTE]) {
      const user = addUsuarioTestRecord({ email: `pat-me-${rol.toLowerCase()}@example.test`, id_externo_sso: `pat-me-${rol}`, rol, nombres: rol, apellidos: 'Pruebas' });
      tokens.set(rol, user.id);
    }
    const module = await createE2eTestingModule({ imports: [AppModule] })
      .overrideModule(DatabaseModule).useModule(DatabaseTestingModule)
      .overrideProvider(ConfigService).useValue(testConfigService())
      .overrideProvider(AuthenticationService).useValue(tokenAuthenticationMock(tokens))
      .overrideProvider(GeneracionesPatService).useValue(generaciones)
      .overrideProvider(DocumentosPatService).useValue(documentos)
      .compile();
    app = module.createNestApplication<INestApplication<App>>();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => { await app?.close(); clearUsuarioTestRecords(); tokens.clear(); });
  beforeEach(() => vi.clearAllMocks());

  it('GET resumen y GET generaciones responden al estudiante y se reservan a su rol', async () => {
    await request(app.getHttpServer()).get(`${base}/resumen`).set(as(UsuarioRol.ESTUDIANTE)).expect(200).expect(({ body }) => expect(body).toMatchObject({ pendientes: ['confirma_problematica'], automaticos: { curso: { valor: 'Octavo' } } }));
    await request(app.getHttpServer()).get(`${base}/generaciones`).set(as(UsuarioRol.ESTUDIANTE)).expect(200).expect(({ body }) => expect(body).toMatchObject({ total: 1, data: [{ id: generacionId }] }));
    await request(app.getHttpServer()).get(`${base}/resumen`).set(as(UsuarioRol.ADMIN)).expect(403);
    await request(app.getHttpServer()).get(`${base}/generaciones`).set(as(UsuarioRol.DOCENTE)).expect(403);
    await request(app.getHttpServer()).get(`${base}/resumen`).expect(401);
    await request(app.getHttpServer()).get('/periodos/no-uuid/asignaciones-tema/00000000-0000-4000-8000-000000000011/pat/me/resumen').set(as(UsuarioRol.ESTUDIANTE)).expect(400);
    expect(generaciones.resumen).toHaveBeenCalledTimes(1);
  });

  it('POST entregar crea la versión GENERADO solo para ESTUDIANTE con identificadores válidos', async () => {
    await request(app.getHttpServer()).post(`${base}/generaciones/${generacionId}/entregar`).set(as(UsuarioRol.ESTUDIANTE)).expect(201).expect(({ body }) => expect(body).toMatchObject({ origen: 'GENERADO', firmado: false }));
    expect(documentos.entregarGenerada).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000011', generacionId, expect.objectContaining({ rol: UsuarioRol.ESTUDIANTE }), expect.anything());
    await request(app.getHttpServer()).post(`${base}/generaciones/${generacionId}/entregar`).set(as(UsuarioRol.ADMIN)).expect(403);
    await request(app.getHttpServer()).post(`${base}/generaciones/no-uuid/entregar`).set(as(UsuarioRol.ESTUDIANTE)).expect(400);
    expect(documentos.entregarGenerada).toHaveBeenCalledTimes(1);
  });

  it('PATCH pat/me valida tutor_propuesto_id y articulaciones antes del servicio', async () => {
    await request(app.getHttpServer()).patch(base).set(as(UsuarioRol.ESTUDIANTE)).send({ tutor_propuesto_id: 'no-uuid' }).expect(400);
    await request(app.getHttpServer()).patch(base).set(as(UsuarioRol.ESTUDIANTE)).send({ articulaciones: ['OTRA_COSA'] }).expect(400);
    await request(app.getHttpServer()).patch(base).set(as(UsuarioRol.ESTUDIANTE)).send({ campo_extra: true }).expect(400);
    expect(generaciones.actualizarContenido).not.toHaveBeenCalled();
    await request(app.getHttpServer()).patch(base).set(as(UsuarioRol.ESTUDIANTE)).send({ tutor_propuesto_id: null, articulaciones: ['INVESTIGACION', 'DOCENCIA'] }).expect(200);
    expect(generaciones.actualizarContenido).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ tutor_propuesto_id: null }), expect.anything(), expect.anything());
  });

  it('POST generaciones acepta cuerpo vacío y reintentar responde EN_COLA', async () => {
    await request(app.getHttpServer()).post(`${base}/generaciones`).set(as(UsuarioRol.ESTUDIANTE)).send({}).expect(202).expect(({ body }) => expect(body).toEqual({ id: generacionId, estado: 'EN_COLA' }));
    await request(app.getHttpServer()).post(`${base}/generaciones/${generacionId}/reintentar`).set(as(UsuarioRol.ESTUDIANTE)).expect(201).expect(({ body }) => expect(body).toEqual({ id: generacionId, estado: 'EN_COLA' }));
  });

  it('documenta las rutas nuevas en Swagger', async () => {
    const response = await request(app.getHttpServer()).get('/docs-json').expect(200);
    const paths = response.body.paths as Record<string, unknown>;
    const prefix = '/periodos/{periodoId}/asignaciones-tema/{asignacionId}/pat/me';
    for (const path of ['/resumen', '/generaciones', '/generaciones/{id}/entregar']) expect(paths).toHaveProperty(`${prefix}${path}`);
  });
});
