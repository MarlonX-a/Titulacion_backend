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
import { AsignacionesTutorService } from '../src/asignaciones-tutor/asignaciones-tutor.service.js';
import { DocumentosPatService } from '../src/documentos-pat/documentos-pat.service.js';
import { ResumenPeriodoService } from '../src/periodos/resumen-periodo.service.js';
import { PeriodosService } from '../src/periodos/periodos.service.js';
import { UsuarioRol } from '../src/usuarios/enums/usuario-rol.enum.js';
import { addUsuarioTestRecord, clearUsuarioTestRecords, DatabaseTestingModule } from './database-testing.module.js';

describe('Consultas agregadas de período (e2e)', () => {
  let app: INestApplication<App>;
  const tokens = new Map<string, string>();
  const periodo = '00000000-0000-4000-8000-000000000010';
  const page = { data: [], total: 0, page: 1, limit: 20 };
  const resumen = { obtener: vi.fn(async (id: string) => ({ periodo_id: id, estudiantes_habilitados: 3, condicionados_pendientes: 1, conflictos_abiertos: 0, asignaciones_vigentes: 2, tutores_asignados: 1, sin_tutor: 1, pat_por_revisar: 1 })) };
  const tutores = { cargaDelPeriodo: vi.fn(async (_p: string, pageNumber: number, limit: number) => ({ ...page, page: pageNumber, limit })) };
  const documentos = { ultimasDelPeriodo: vi.fn(async () => page) };
  const periodos = {
    list: vi.fn(async (_query: unknown, admin: boolean) => ({ ...page, data: [{ id: periodo, ...(admin ? { condicionados_pendientes: 2 } : {}) }] })),
    getById: vi.fn(async (id: string, admin: boolean) => ({ id, ...(admin ? { condicionados_pendientes: 2 } : {}) })),
  };

  beforeAll(async () => {
    clearUsuarioTestRecords();
    for (const rol of [UsuarioRol.ADMIN, UsuarioRol.DOCENTE, UsuarioRol.ESTUDIANTE]) {
      const user = addUsuarioTestRecord({ email: `${rol.toLowerCase()}-agregadas@live.uleam.edu.ec`, id_externo_sso: `agregadas-${rol}`, rol, nombres: rol, apellidos: 'Prueba' });
      tokens.set(rol, user.id);
    }
    const config = new ConfigService<AppEnvironment, true>({
      NODE_ENV: 'test', PORT: 3000, SWAGGER_ENABLED: true, DB_HOST: '127.0.0.1', DB_PORT: 5432,
      DB_SCHEMA: 'test', DB_USERNAME: 'test_user', DB_PASSWORD: 'test_password', DB_NAME: 'test_database',
      AUTH_ISSUER: 'http://127.0.0.1:3000', AUTH_ORIGINS: [], REDIS_PORT: 6379, SMTP_PORT: 1025, S3_REGION: 'us-east-1',
    });
    const auth = { verifyToken: vi.fn(async (token: string) => ({ subject: tokens.get(token) ?? '', issuer: 'http://127.0.0.1:3000', firstAccess: false })) };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideModule(DatabaseModule).useModule(DatabaseTestingModule)
      .overrideProvider(ConfigService).useValue(config)
      .overrideProvider(AuthenticationService).useValue(auth)
      .overrideProvider(ResumenPeriodoService).useValue(resumen)
      .overrideProvider(AsignacionesTutorService).useValue(tutores)
      .overrideProvider(DocumentosPatService).useValue(documentos)
      .overrideProvider(PeriodosService).useValue(periodos)
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

  it('GET /periodos/:id/resumen es solo ADMIN y devuelve los indicadores', async () => {
    await get(`/periodos/${periodo}/resumen`).expect(401);
    await get(`/periodos/${periodo}/resumen`, UsuarioRol.DOCENTE).expect(403);
    await get(`/periodos/${periodo}/resumen`, UsuarioRol.ESTUDIANTE).expect(403);
    await get('/periodos/no-uuid/resumen', UsuarioRol.ADMIN).expect(400);
    expect(resumen.obtener).not.toHaveBeenCalled();
    await get(`/periodos/${periodo}/resumen`, UsuarioRol.ADMIN).expect(200).expect(({ body }) => expect(body).toMatchObject({ periodo_id: periodo, condicionados_pendientes: 1, sin_tutor: 1 }));
  });

  it('GET /periodos/:pid/carga-tutorial es solo ADMIN y transmite la paginación', async () => {
    await get(`/periodos/${periodo}/carga-tutorial`, UsuarioRol.DOCENTE).expect(403);
    await get(`/periodos/${periodo}/carga-tutorial`, UsuarioRol.ESTUDIANTE).expect(403);
    await get(`/periodos/${periodo}/carga-tutorial?limit=101`, UsuarioRol.ADMIN).expect(400);
    expect(tutores.cargaDelPeriodo).not.toHaveBeenCalled();
    await get(`/periodos/${periodo}/carga-tutorial?page=2&limit=50`, UsuarioRol.ADMIN).expect(200).expect(({ body }) => expect(body).toMatchObject({ page: 2, limit: 50 }));
    expect(tutores.cargaDelPeriodo).toHaveBeenCalledWith(periodo, 2, 50);
  });

  it('GET /periodos/:pid/documentos-pat/ultimas es solo ADMIN y valida el estado', async () => {
    await get(`/periodos/${periodo}/documentos-pat/ultimas`, UsuarioRol.DOCENTE).expect(403);
    await get(`/periodos/${periodo}/documentos-pat/ultimas`, UsuarioRol.ESTUDIANTE).expect(403);
    await get(`/periodos/${periodo}/documentos-pat/ultimas?estado=OTRO`, UsuarioRol.ADMIN).expect(400);
    expect(documentos.ultimasDelPeriodo).not.toHaveBeenCalled();
    await get(`/periodos/${periodo}/documentos-pat/ultimas?estado=PENDIENTE`, UsuarioRol.ADMIN).expect(200);
    expect(documentos.ultimasDelPeriodo).toHaveBeenCalledWith(periodo, expect.objectContaining({ estado: 'PENDIENTE', page: 1, limit: 20 }));
  });

  it('solo ADMIN recibe condicionados_pendientes en los períodos', async () => {
    await get('/periodos', UsuarioRol.ADMIN).expect(200).expect(({ body }) => expect(body.data[0]).toHaveProperty('condicionados_pendientes', 2));
    await get('/periodos', UsuarioRol.ESTUDIANTE).expect(200).expect(({ body }) => expect(body.data[0]).not.toHaveProperty('condicionados_pendientes'));
    await get(`/periodos/${periodo}`, UsuarioRol.DOCENTE).expect(200).expect(({ body }) => expect(body).not.toHaveProperty('condicionados_pendientes'));
    expect(periodos.getById).toHaveBeenLastCalledWith(periodo, false);
  });

  it('publica las rutas nuevas en Swagger', async () => {
    await get('/docs-json').expect(200).expect(({ body }) => {
      expect(body.paths).toHaveProperty('/periodos/{id}/resumen');
      expect(body.paths['/periodos/{periodoId}/carga-tutorial']).toHaveProperty('get');
      expect(body.paths).toHaveProperty('/periodos/{periodoId}/documentos-pat/ultimas');
    });
  });
});
