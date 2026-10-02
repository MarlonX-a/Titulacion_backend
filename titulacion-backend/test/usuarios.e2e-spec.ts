import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import type { CryptoKey } from 'jose';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { Test as SupertestTest } from 'supertest';
import { AppModule } from '../src/app.module.js';
import type { AppEnvironment } from '../src/config/environment.js';
import { configureApplication } from '../src/config/setup-app.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { UsuarioEstado } from '../src/usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../src/usuarios/enums/usuario-rol.enum.js';
import { UsuariosService } from '../src/usuarios/usuarios.service.js';
import {
  addUsuarioTestRecord,
  clearUsuarioTestRecords,
  DatabaseTestingModule,
} from './database-testing.module.js';

describe('Usuarios (e2e)', () => {
  let app: INestApplication<App>;
  let server: Server;
  let issuer: string;
  let jwksUri: string;
  let privateKey: CryptoKey;
  let publicJwk: JWK;
  const tokens = new Map<string, string>();

  async function createToken(subject: string, roleClaim?: string) {
    return new SignJWT(roleClaim ? { role: roleClaim } : {})
      .setProtectedHeader({ alg: 'RS256', kid: 'users-test-key' })
      .setIssuer(issuer)
      .setAudience('titulacion-api-test')
      .setSubject(subject)
      .setExpirationTime('2m')
      .sign(privateKey);
  }

  function authenticated(
    method: 'get' | 'post',
    path: string,
    subject: string,
    roleClaim?: string,
  ): SupertestTest {
    const token = tokens.get(`${subject}:${roleClaim ?? ''}`);
    if (!token) throw new Error('No existe el token de prueba solicitado.');
    return request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${token}`);
  }

  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    privateKey = keys.privateKey;
    publicJwk = await exportJWK(keys.publicKey);
    publicJwk.kid = 'users-test-key';
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';

    server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ keys: [publicJwk] }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    issuer = `http://127.0.0.1:${address.port}/issuer`;
    jwksUri = `http://127.0.0.1:${address.port}/jwks`;
    for (const subject of [
      'admin-sub',
      'student-sub',
      'inactive-sub',
      'not-registered',
      'bootstrap-sub',
    ]) {
      tokens.set(`${subject}:`, await createToken(subject));
      tokens.set(`${subject}:ADMIN`, await createToken(subject, 'ADMIN'));
    }

    const config = new ConfigService<AppEnvironment, true>({
      NODE_ENV: 'test',
      PORT: 3000,
      SWAGGER_ENABLED: true,
      DB_HOST: '127.0.0.1',
      DB_PORT: 1,
      DB_USERNAME: 'test_user',
      DB_PASSWORD: 'test_password',
      DB_NAME: 'test_database',
      OIDC_ISSUER: issuer,
      OIDC_AUDIENCE: 'titulacion-api-test',
      JWKS_URI: jwksUri,
    });
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideModule(DatabaseModule)
      .useModule(DatabaseTestingModule)
      .overrideProvider(ConfigService)
      .useValue(config)
      .compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    configureApplication(app);
    await app.init();
  });

  beforeEach(() => clearUsuarioTestRecords());

  afterAll(async () => {
    await app?.close();
    server?.close();
    await once(server, 'close');
  });

  function addAdmin() {
    return addUsuarioTestRecord({
      id_externo_sso: 'admin-sub',
      email: 'admin@universidad.edu',
      nombres: 'Ana',
      apellidos: 'Administradora',
      rol: UsuarioRol.ADMIN,
    });
  }

  it('crea usuarios solo por ADMIN y normaliza email y nombres', async () => {
    addAdmin();
    const response = await authenticated('post', '/usuarios', 'admin-sub')
      .send({
        email: '  Persona@Universidad.EDU ',
        nombres: '  María Elena ',
        apellidos: ' Pérez ',
        rol: UsuarioRol.ESTUDIANTE,
        id_externo_sso: 'student-sub',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      email: 'persona@universidad.edu',
      nombres: 'María Elena',
      apellidos: 'Pérez',
      rol: UsuarioRol.ESTUDIANTE,
      estado: UsuarioEstado.ACTIVO,
      ultimo_acceso: null,
    });
    expect(response.body).not.toHaveProperty('id_externo_sso');
    expect(response.body).not.toHaveProperty('password');
  });

  it('prohíbe crear cuentas y listar a usuarios que no son ADMIN aunque el JWT lo afirme', async () => {
    addUsuarioTestRecord({
      id_externo_sso: 'student-sub',
      email: 'student@universidad.edu',
      nombres: 'Estudiante',
      apellidos: 'Prueba',
      rol: UsuarioRol.ESTUDIANTE,
    });

    await authenticated('get', '/usuarios', 'student-sub', 'ADMIN').expect(403);
    await authenticated('post', '/usuarios', 'student-sub', 'ADMIN')
      .send({})
      .expect(403);
  });

  it('rechaza cuentas sin coincidencia SSO o inactivas y conserva GET /auth/me', async () => {
    addUsuarioTestRecord({
      id_externo_sso: 'inactive-sub',
      email: 'inactive@universidad.edu',
      nombres: 'Cuenta',
      apellidos: 'Inactiva',
      rol: UsuarioRol.ADMIN,
      estado: UsuarioEstado.INACTIVO,
    });

    await authenticated('get', '/usuarios', 'not-registered').expect(403);
    await authenticated('get', '/usuarios', 'inactive-sub').expect(403);
    const identity = await authenticated(
      'get',
      '/auth/me',
      'not-registered',
    ).expect(200);
    expect(identity.body).toEqual({ subject: 'not-registered', issuer });
  });

  it('devuelve el perfil propio y actualiza ultimo_acceso', async () => {
    addUsuarioTestRecord({
      id_externo_sso: 'student-sub',
      email: 'student@universidad.edu',
      nombres: 'Estudiante',
      apellidos: 'Prueba',
      rol: UsuarioRol.ESTUDIANTE,
    });

    const response = await authenticated(
      'get',
      '/usuarios/me',
      'student-sub',
    ).expect(200);
    expect(response.body.email).toBe('student@universidad.edu');
    expect(response.body.ultimo_acceso).toEqual(expect.any(String));
    expect(response.body).not.toHaveProperty('id_externo_sso');
  });

  it('crea conflictos en email o subject duplicados', async () => {
    addAdmin();
    const makeRequest = (email: string, subject: string) =>
      authenticated('post', '/usuarios', 'admin-sub').send({
        email,
        nombres: 'Persona',
        apellidos: 'Prueba',
        rol: UsuarioRol.DOCENTE,
        id_externo_sso: subject,
      });

    await makeRequest('nuevo@universidad.edu', 'new-sub').expect(201);
    await makeRequest('NUEVO@UNIVERSIDAD.EDU', 'other-sub').expect(409);
    await makeRequest('other@universidad.edu', 'new-sub').expect(409);
  });

  it('permite crear el primer ADMIN una sola vez ante solicitudes simultáneas', async () => {
    const usuarios = app.get(UsuariosService);
    const attempts = await Promise.allSettled([
      usuarios.createInitialAdmin({
        email: 'bootstrap@universidad.edu',
        nombres: 'Admin',
        apellidos: 'Inicial',
        id_externo_sso: 'bootstrap-sub',
      }),
      usuarios.createInitialAdmin({
        email: 'bootstrap-2@universidad.edu',
        nombres: 'Admin',
        apellidos: 'Inicial',
        id_externo_sso: 'bootstrap-sub-2',
      }),
    ]);
    expect(
      attempts.filter((attempt) => attempt.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.status === 'rejected'),
    ).toHaveLength(1);
  });

  it('lista de forma paginada y orden estable solo para ADMIN', async () => {
    addAdmin();
    for (let index = 0; index < 3; index += 1) {
      addUsuarioTestRecord({
        id_externo_sso: `student-${index}`,
        email: `student-${index}@universidad.edu`,
        nombres: `Estudiante ${index}`,
        apellidos: 'Prueba',
        rol: UsuarioRol.ESTUDIANTE,
      });
    }

    const response = await authenticated(
      'get',
      '/usuarios?page=2&limit=2',
      'admin-sub',
    ).expect(200);
    expect(response.body).toMatchObject({ total: 4, page: 2, limit: 2 });
    expect(response.body.data).toHaveLength(2);
  });

  it.each([
    '/usuarios?page=0',
    '/usuarios?limit=101',
    '/usuarios?unexpected=true',
  ])('rechaza parámetros de listado inválidos: %s', async (path) => {
    addAdmin();
    await authenticated('get', path, 'admin-sub').expect(400);
  });

  it('rechaza campos gestionados por el servidor en el alta', async () => {
    addAdmin();
    await authenticated('post', '/usuarios', 'admin-sub')
      .send({
        email: 'persona@universidad.edu',
        nombres: 'Persona',
        apellidos: 'Prueba',
        rol: UsuarioRol.ADMIN,
        id_externo_sso: 'new-sub',
        estado: UsuarioEstado.INACTIVO,
        id: '00000000-0000-4000-8000-000000000000',
      })
      .expect(400);
  });

  it('rechaza datos faltantes y mantiene el contrato de usuario en Swagger', async () => {
    addAdmin();
    await authenticated('post', '/usuarios', 'admin-sub')
      .send({
        email: 'invalid',
        nombres: ' ',
        apellidos: '',
        rol: 'SUPERADMIN',
      })
      .expect(400);

    const document = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    expect(document.body.components.schemas.UsuarioResponseDto).toBeDefined();
    expect(document.body.paths['/usuarios'].get.security).toEqual([
      { bearer: [] },
    ]);
  });
});
