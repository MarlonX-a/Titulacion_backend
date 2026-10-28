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
import { AuditoriaConsultaService } from '../src/auditoria/auditoria-consulta.service.js';
import { ImportacionesHistorialService } from '../src/importaciones/importaciones-historial.service.js';
import { ImportacionesController } from '../src/importaciones/importaciones.controller.js';
import { ImportacionesDocentesController } from '../src/importaciones/importaciones-docentes.controller.js';
import { ImportacionesService } from '../src/importaciones/importaciones.service.js';
import { ImportacionesDocentesService } from '../src/importaciones/importaciones-docentes.service.js';
import { NotificacionesService } from '../src/notificaciones/notificaciones.service.js';
import { UsuarioRol } from '../src/usuarios/enums/usuario-rol.enum.js';
import { addUsuarioTestRecord, clearUsuarioTestRecords, DatabaseTestingModule } from './database-testing.module.js';

describe('Auditoría, historial de importaciones y lectura masiva de notificaciones (e2e)', () => {
  let app: INestApplication<App>;
  const tokens = new Map<string, string>();
  const periodo = '00000000-0000-4000-8000-000000000010';
  const page = { data: [], total: 0, page: 1, limit: 20 };
  const auditoria = { listar: vi.fn(async (query: { page: number; limit: number }) => ({ ...page, page: query.page, limit: query.limit })) };
  const historial = { listarEstudiantes: vi.fn(async () => page), listarDocentes: vi.fn(async () => page) };
  const notificaciones = { marcarTodasLeidas: vi.fn(async (actor: { id: string }) => ({ actualizadas: actor.id ? 2 : 0 })) };

  beforeAll(async () => {
    clearUsuarioTestRecords();
    for (const rol of [UsuarioRol.ADMIN, UsuarioRol.DOCENTE, UsuarioRol.ESTUDIANTE]) {
      const user = addUsuarioTestRecord({ email: `${rol.toLowerCase()}-consultas@live.uleam.edu.ec`, id_externo_sso: `consultas-${rol}`, rol, nombres: rol, apellidos: 'Prueba' });
      tokens.set(rol, user.id);
    }
    const config = new ConfigService<AppEnvironment, true>({
      NODE_ENV: 'test', PORT: 3000, SWAGGER_ENABLED: true, DB_HOST: '127.0.0.1', DB_PORT: 5432,
      DB_SCHEMA: 'test', DB_USERNAME: 'test_user', DB_PASSWORD: 'test_password', DB_NAME: 'test_database',
      AUTH_ISSUER: 'http://127.0.0.1:3000', AUTH_ORIGINS: [], REDIS_PORT: 6379, SMTP_PORT: 1025, S3_REGION: 'us-east-1',
    });
    const auth = { verifyToken: vi.fn(async (token: string) => ({ subject: tokens.get(token) ?? '', issuer: 'http://127.0.0.1:3000', firstAccess: false })) };
    // ImportacionesModule no se carga con NODE_ENV=test (requiere Redis): se montan sus controladores con servicios simulados.
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ImportacionesController, ImportacionesDocentesController],
      providers: [
        { provide: ImportacionesHistorialService, useValue: historial },
        { provide: ImportacionesService, useValue: {} },
        { provide: ImportacionesDocentesService, useValue: {} },
      ],
    })
      .overrideModule(DatabaseModule).useModule(DatabaseTestingModule)
      .overrideProvider(ConfigService).useValue(config)
      .overrideProvider(AuthenticationService).useValue(auth)
      .overrideProvider(AuditoriaConsultaService).useValue(auditoria)
      .overrideProvider(NotificacionesService).useValue(notificaciones)
      .compile();
    app = module.createNestApplication<INestApplication<App>>();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => { await app.close(); clearUsuarioTestRecords(); tokens.clear(); });

  const get = (path: string, rol?: UsuarioRol) => {
    const call = request(app.getHttpServer()).get(path);
    return rol ? call.set('Authorization', `Bearer ${rol}`) : call;
  };

  it('restringe GET /auditoria a ADMIN', async () => {
    await get('/auditoria').expect(401);
    await get('/auditoria', UsuarioRol.DOCENTE).expect(403);
    await get('/auditoria', UsuarioRol.ESTUDIANTE).expect(403);
    expect(auditoria.listar).not.toHaveBeenCalled();
    await get('/auditoria?page=2&limit=5', UsuarioRol.ADMIN).expect(200).expect(({ body }) => expect(body).toMatchObject({ page: 2, limit: 5 }));
  });

  it('valida y transmite los filtros de auditoría', async () => {
    const id = '00000000-0000-4000-8000-0000000000aa';
    await get(`/auditoria?entidad_tipo=tema&entidad_id=${id}&accion=EDITAR_TEMA&usuario_id=${id}&desde=2026-10-01&hasta=2026-10-31&q=%20admin%20`, UsuarioRol.ADMIN).expect(200);
    expect(auditoria.listar).toHaveBeenLastCalledWith(expect.objectContaining({ entidad_tipo: 'tema', entidad_id: id, accion: 'EDITAR_TEMA', usuario_id: id, desde: '2026-10-01', hasta: '2026-10-31', q: 'admin' }));
    const calls = auditoria.listar.mock.calls.length;
    for (const bad of ['entidad_id=no-uuid', 'usuario_id=1', 'desde=ayer', 'limit=101', 'accion=crear tema', 'otro=1']) {
      await get(`/auditoria?${bad}`, UsuarioRol.ADMIN).expect(400);
    }
    expect(auditoria.listar).toHaveBeenCalledTimes(calls);
  });

  it('restringe el historial de importaciones a ADMIN y valida el período', async () => {
    await get(`/periodos/${periodo}/importaciones/estudiantes`, UsuarioRol.ESTUDIANTE).expect(403);
    await get('/importaciones/docentes', UsuarioRol.DOCENTE).expect(403);
    await get('/periodos/no-uuid/importaciones/estudiantes', UsuarioRol.ADMIN).expect(400);
    expect(historial.listarEstudiantes).not.toHaveBeenCalled();
    await get(`/periodos/${periodo}/importaciones/estudiantes?limit=10`, UsuarioRol.ADMIN).expect(200);
    expect(historial.listarEstudiantes).toHaveBeenCalledWith(periodo, expect.objectContaining({ page: 1, limit: 10 }));
    await get('/importaciones/docentes', UsuarioRol.ADMIN).expect(200);
    expect(historial.listarDocentes).toHaveBeenCalledTimes(1);
  });

  it('marca todas las notificaciones del usuario autenticado y rechaza cuerpos', async () => {
    await request(app.getHttpServer()).post('/notificaciones/leer-todas').expect(401);
    await request(app.getHttpServer()).post('/notificaciones/leer-todas').set('Authorization', `Bearer ${UsuarioRol.ESTUDIANTE}`).send({ usuario_id: tokens.get(UsuarioRol.ADMIN) }).expect(400);
    await request(app.getHttpServer()).post('/notificaciones/leer-todas').set('Authorization', `Bearer ${UsuarioRol.ESTUDIANTE}`).expect(200).expect(({ body }) => expect(body).toEqual({ actualizadas: 2 }));
    expect(notificaciones.marcarTodasLeidas).toHaveBeenCalledTimes(1);
    expect(notificaciones.marcarTodasLeidas).toHaveBeenCalledWith(expect.objectContaining({ id: tokens.get(UsuarioRol.ESTUDIANTE) }));
  });

  it('publica los endpoints nuevos en Swagger', async () => {
    await get('/docs-json').expect(200).expect(({ body }) => {
      expect(body.paths).toHaveProperty('/auditoria');
      expect(body.paths).toHaveProperty('/periodos/{periodoId}/importaciones/estudiantes');
      expect(body.paths['/importaciones/docentes']).toHaveProperty('get');
      expect(body.paths).toHaveProperty('/notificaciones/leer-todas');
    });
  });
});
