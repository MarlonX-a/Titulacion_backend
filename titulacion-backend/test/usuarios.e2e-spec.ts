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
import { PeriodoEstado } from '../src/periodos/enums/periodo-estado.enum.js';
import {
  addUsuarioTestRecord,
  clearUsuarioTestRecords,
  setPeriodoTestEstado,
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
    method: 'get' | 'post' | 'patch',
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
      'docente-sub',
      'other-student-sub',
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

  it('permite al ADMIN crear y consultar perfiles vinculados a cuentas compatibles', async () => {
    addAdmin();
    const student = addUsuarioTestRecord({
      id_externo_sso: 'student-sub',
      email: 'student@universidad.edu',
      nombres: 'Estudiante',
      apellidos: 'Prueba',
      rol: UsuarioRol.ESTUDIANTE,
    });
    const teacher = addUsuarioTestRecord({
      id_externo_sso: 'docente-sub',
      email: 'docente@universidad.edu',
      nombres: 'Docente',
      apellidos: 'Prueba',
      rol: UsuarioRol.DOCENTE,
    });

    const studentProfile = await authenticated(
      'post',
      '/estudiantes',
      'admin-sub',
    )
      .send({
        usuario_id: student.id,
        cedula: '0102030400',
        matricula: '  000123  ',
        carrera: '  Sistemas  ',
        nivel: 5,
      })
      .expect(201);

    expect(studentProfile.body).toMatchObject({
      usuario: {
        id: student.id,
        email: 'student@universidad.edu',
        rol: UsuarioRol.ESTUDIANTE,
      },
      cedula: '0102030400',
      matricula: '000123',
      carrera: 'Sistemas',
      nivel: 5,
    });
    expect(studentProfile.body.usuario).not.toHaveProperty('id_externo_sso');

    const teacherProfile = await authenticated(
      'post',
      '/docentes',
      'admin-sub',
    )
      .send({
        usuario_id: teacher.id,
        cedula: '3002030405',
        titulo_academico: 'Magíster',
        departamento: 'Ciencias',
      })
      .expect(201);
    expect(teacherProfile.body.habilitado_tutoria).toBe(false);

    await authenticated('get', '/estudiantes?page=1&limit=5', 'admin-sub')
      .expect(200)
      .then((response) => {
        expect(response.body).toMatchObject({ total: 1, page: 1, limit: 5 });
        expect(response.body.data[0].id).toBe(studentProfile.body.id);
      });
    await authenticated('get', `/estudiantes/${studentProfile.body.id}`, 'admin-sub')
      .expect(200)
      .then((response) => expect(response.body.id).toBe(studentProfile.body.id));
    await authenticated('get', `/docentes/${teacherProfile.body.id}`, 'admin-sub')
      .expect(200)
      .then((response) => expect(response.body.id).toBe(teacherProfile.body.id));
  });

  it('limita /me al rol y perfil propios, y reserva listados y detalle para ADMIN', async () => {
    addAdmin();
    const student = addUsuarioTestRecord({
      id_externo_sso: 'student-sub',
      email: 'student@universidad.edu',
      nombres: 'Estudiante',
      apellidos: 'Prueba',
      rol: UsuarioRol.ESTUDIANTE,
    });
    const otherStudent = addUsuarioTestRecord({
      id_externo_sso: 'other-student-sub',
      email: 'other@universidad.edu',
      nombres: 'Otra',
      apellidos: 'Estudiante',
      rol: UsuarioRol.ESTUDIANTE,
    });
    const teacher = addUsuarioTestRecord({
      id_externo_sso: 'docente-sub',
      email: 'docente@universidad.edu',
      nombres: 'Docente',
      apellidos: 'Prueba',
      rol: UsuarioRol.DOCENTE,
    });

    const studentProfile = await authenticated('post', '/estudiantes', 'admin-sub')
      .send({
        usuario_id: student.id,
        cedula: '0102030400',
        matricula: '1001',
        carrera: 'Sistemas',
        nivel: 1,
      })
      .expect(201);
    await authenticated('post', '/estudiantes', 'admin-sub')
      .send({
        usuario_id: otherStudent.id,
        cedula: '0102030418',
        matricula: '1002',
        carrera: 'Sistemas',
        nivel: 2,
      })
      .expect(201);
    const teacherProfile = await authenticated('post', '/docentes', 'admin-sub')
      .send({
        usuario_id: teacher.id,
        cedula: '3002030405',
        titulo_academico: 'Magíster',
        departamento: 'Ciencias',
        habilitado_tutoria: true,
      })
      .expect(201);

    await authenticated('get', '/estudiantes/me', 'student-sub')
      .expect(200)
      .then((response) => expect(response.body.id).toBe(studentProfile.body.id));
    await authenticated('get', '/estudiantes/me', 'docente-sub').expect(403);
    await authenticated('get', '/docentes/me', 'student-sub').expect(403);
    await authenticated('get', '/docentes/me', 'docente-sub')
      .expect(200)
      .then((response) => expect(response.body.id).toBe(teacherProfile.body.id));
    await authenticated('get', '/estudiantes', 'student-sub').expect(403);
    await authenticated('get', `/estudiantes/${studentProfile.body.id}`, 'other-student-sub').expect(403);
    await authenticated('get', '/estudiantes/me', 'other-student-sub')
      .expect(200)
      .then((response) => expect(response.body.usuario.id).toBe(otherStudent.id));
  });

  it('rechaza cédulas inválidas, roles incompatibles, cuentas inexistentes y duplicados', async () => {
    addAdmin();
    const student = addUsuarioTestRecord({
      id_externo_sso: 'student-sub',
      email: 'student@universidad.edu',
      nombres: 'Estudiante',
      apellidos: 'Prueba',
      rol: UsuarioRol.ESTUDIANTE,
    });
    const inactive = addUsuarioTestRecord({
      id_externo_sso: 'inactive-sub',
      email: 'inactive@universidad.edu',
      nombres: 'Cuenta',
      apellidos: 'Inactiva',
      rol: UsuarioRol.ESTUDIANTE,
      estado: UsuarioEstado.INACTIVO,
    });

    const validProfile = {
      usuario_id: student.id,
      cedula: '0102030400',
      matricula: '2001',
      carrera: 'Sistemas',
      nivel: 1,
    };
    await authenticated('post', '/estudiantes', 'admin-sub')
      .send({ ...validProfile, cedula: '0102030401' })
      .expect(400);
    await authenticated('post', '/estudiantes', 'admin-sub')
      .send({ ...validProfile, usuario_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })
      .expect(404);
    await authenticated('post', '/estudiantes', 'admin-sub')
      .send({ ...validProfile, usuario_id: inactive.id, matricula: '2002' })
      .expect(409);
    await authenticated('post', '/docentes', 'admin-sub')
      .send({
        usuario_id: student.id,
        cedula: '3002030405',
        titulo_academico: 'Magíster',
        departamento: 'Ciencias',
      })
      .expect(409);
    await authenticated('post', '/estudiantes', 'admin-sub')
      .send(validProfile)
      .expect(201);
    await authenticated('post', '/estudiantes', 'admin-sub')
      .send({ ...validProfile, matricula: '2003' })
      .expect(409);
    await authenticated('post', '/estudiantes', 'admin-sub')
      .send({ ...validProfile, usuario_id: inactive.id })
      .expect(409);
    await authenticated('get', '/docentes/me', 'docente-sub').expect(403);
  });

  it('rechaza datos y paginación inválidos y documenta perfiles en Swagger', async () => {
    addAdmin();
    await authenticated('post', '/estudiantes', 'admin-sub')
      .send({
        usuario_id: 'not-a-uuid',
        cedula: '0102030400',
        matricula: '1',
        carrera: 'Sistemas',
        nivel: 1,
        estado: 'ACTIVO',
      })
      .expect(400);
    await authenticated('get', '/estudiantes?limit=101', 'admin-sub').expect(400);
    await authenticated('get', '/docentes?unexpected=true', 'admin-sub').expect(400);
    const document = await request(app.getHttpServer()).get('/docs-json').expect(200);
    expect(document.body.paths['/estudiantes'].post.security).toEqual([
      { bearer: [] },
    ]);
    expect(document.body.paths['/docentes/me'].get).toBeDefined();
  });

  it('ADMIN crea períodos BORRADOR y normaliza las fechas a UTC', async () => {
    addAdmin();
    const response = await authenticated('post', '/periodos', 'admin-sub')
      .send({
        codigo: '  2026-A  ',
        nombre: '  Titulación ciclo A  ',
        fecha_inicio_postulacion: '2026-11-02T08:00:00-05:00',
        fecha_fin_postulacion: '2026-11-30T23:59:00-05:00',
        fecha_inicio_titulacion: '2026-12-01T08:00:00-05:00',
        max_integrantes_default: '5',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      codigo: '2026-A',
      nombre: 'Titulación ciclo A',
      fecha_inicio_postulacion: '2026-11-02T13:00:00.000Z',
      fecha_fin_postulacion: '2026-12-01T04:59:00.000Z',
      fecha_inicio_titulacion: '2026-12-01T13:00:00.000Z',
      max_integrantes_default: 5,
      estado: PeriodoEstado.BORRADOR,
    });
  });

  it('valida fechas, zona horaria, límites, cuerpo y campos administrados', async () => {
    addAdmin();
    const valid = {
      codigo: 'CICLO-1',
      nombre: 'Período de prueba',
      fecha_inicio_postulacion: '2026-11-02T08:00:00-05:00',
      fecha_fin_postulacion: '2026-11-30T23:59:00-05:00',
      fecha_inicio_titulacion: '2026-12-01T08:00:00-05:00',
      max_integrantes_default: 5,
    };

    await authenticated('post', '/periodos', 'admin-sub')
      .send({ ...valid, fecha_inicio_postulacion: '2026-02-30T08:00:00-05:00' })
      .expect(400);
    await authenticated('post', '/periodos', 'admin-sub')
      .send({ ...valid, fecha_inicio_postulacion: '2026-11-02T08:00:00' })
      .expect(400);
    await authenticated('post', '/periodos', 'admin-sub')
      .send({ ...valid, fecha_fin_postulacion: '2026-11-01T08:00:00-05:00' })
      .expect(400);
    await authenticated('post', '/periodos', 'admin-sub')
      .send({ ...valid, fecha_inicio_titulacion: '2026-11-30T22:00:00-05:00' })
      .expect(400);
    await authenticated('post', '/periodos', 'admin-sub')
      .send({ ...valid, max_integrantes_default: 0 })
      .expect(400);
    await authenticated('post', '/periodos', 'admin-sub')
      .send({ ...valid, max_integrantes_default: 32768 })
      .expect(400);
    await authenticated('post', '/periodos', 'admin-sub')
      .send({ ...valid, nombre: '   ' })
      .expect(400);
    await authenticated('post', '/periodos', 'admin-sub')
      .send({ ...valid, estado: PeriodoEstado.EN_CURSO })
      .expect(400);
    await authenticated('post', '/periodos', 'admin-sub')
      .send({ ...valid, id: '00000000-0000-4000-8000-000000000001' })
      .expect(400);
  });

  it('permite edición parcial en BORRADOR y valida fechas contra valores existentes', async () => {
    addAdmin();
    const created = await authenticated('post', '/periodos', 'admin-sub')
      .send({
        codigo: 'PATCH-1',
        nombre: 'Original',
        fecha_inicio_postulacion: '2026-11-02T08:00:00-05:00',
        fecha_fin_postulacion: '2026-11-30T23:59:00-05:00',
        fecha_inicio_titulacion: '2026-12-01T08:00:00-05:00',
        max_integrantes_default: 4,
      })
      .expect(201);

    await authenticated('patch', `/periodos/${created.body.id}`, 'admin-sub')
      .send({ fecha_inicio_titulacion: '2026-11-30T20:00:00-05:00' })
      .expect(400);
    const updated = await authenticated(
      'patch',
      `/periodos/${created.body.id}`,
      'admin-sub',
    )
      .send({ nombre: 'Actualizado', max_integrantes_default: 6 })
      .expect(200);
    expect(updated.body).toMatchObject({
      nombre: 'Actualizado',
      max_integrantes_default: 6,
      estado: PeriodoEstado.BORRADOR,
    });

    await authenticated('patch', `/periodos/${created.body.id}`, 'admin-sub')
      .send({})
      .expect(400);
    await authenticated('patch', `/periodos/${created.body.id}`, 'admin-sub')
      .send({ nombre: null })
      .expect(400);
    await authenticated('patch', `/periodos/${created.body.id}`, 'admin-sub')
      .send({ estado: PeriodoEstado.ARCHIVADO })
      .expect(400);
    await authenticated('patch', `/periodos/${created.body.id}`, 'admin-sub')
      .send({ nombre: 'Alterado', desconocido: true })
      .expect(400);
  });

  it('administra códigos únicos y períodos paginados con acceso solo ADMIN', async () => {
    addAdmin();
    addUsuarioTestRecord({
      id_externo_sso: 'student-sub',
      email: 'student@universidad.edu',
      nombres: 'Estudiante',
      apellidos: 'Prueba',
      rol: UsuarioRol.ESTUDIANTE,
    });
    const period = (codigo: string, start: string) => ({
      codigo,
      nombre: `Período ${codigo}`,
      fecha_inicio_postulacion: start,
      fecha_fin_postulacion: '2026-11-30T23:59:00-05:00',
      fecha_inicio_titulacion: '2026-12-01T08:00:00-05:00',
      max_integrantes_default: 5,
    });
    await authenticated('post', '/periodos', 'admin-sub')
      .send(period('DUPLICADO', '2026-11-02T08:00:00-05:00'))
      .expect(201);
    await authenticated('post', '/periodos', 'admin-sub')
      .send(period('DUPLICADO', '2026-11-03T08:00:00-05:00'))
      .expect(409);
    await authenticated('post', '/periodos', 'admin-sub')
      .send(period('duplicado', '2026-11-03T08:00:00-05:00'))
      .expect(201);

    const response = await authenticated(
      'get',
      '/periodos?page=1&limit=1',
      'admin-sub',
    ).expect(200);
    expect(response.body).toMatchObject({ total: 2, page: 1, limit: 1 });
    expect(response.body.data).toHaveLength(1);
    await authenticated('get', '/periodos', 'student-sub', 'ADMIN').expect(403);
    await authenticated('post', '/periodos', 'student-sub', 'ADMIN')
      .send({})
      .expect(403);
    const document = await request(app.getHttpServer()).get('/docs-json').expect(200);
    expect(document.body.paths['/periodos'].post.security).toEqual([
      { bearer: [] },
    ]);
    expect(document.body.components.schemas.PeriodoResponseDto).toBeDefined();
  });

  it('rechaza a cuentas ADMIN inactivas en las rutas de períodos', async () => {
    const admin = addAdmin();
    admin.estado = UsuarioEstado.INACTIVO;
    await authenticated('get', '/periodos', 'admin-sub').expect(403);
  });

  it('solo permite editar un período mientras está en BORRADOR y consulta por UUID', async () => {
    addAdmin();
    const created = await authenticated('post', '/periodos', 'admin-sub')
      .send({
        codigo: 'ESTADO-1',
        nombre: 'Período',
        fecha_inicio_postulacion: '2026-11-02T08:00:00-05:00',
        fecha_fin_postulacion: '2026-11-30T23:59:00-05:00',
        fecha_inicio_titulacion: '2026-12-01T08:00:00-05:00',
        max_integrantes_default: 5,
      })
      .expect(201);
    await authenticated('get', `/periodos/${created.body.id}`, 'admin-sub')
      .expect(200)
      .then((response) => expect(response.body.estado).toBe(PeriodoEstado.BORRADOR));
    await authenticated('get', '/periodos/no-es-uuid', 'admin-sub').expect(400);
    await authenticated(
      'get',
      '/periodos/00000000-0000-4000-8000-000000000001',
      'admin-sub',
    ).expect(404);

    setPeriodoTestEstado(created.body.id, PeriodoEstado.POSTULACION_ABIERTA);
    await authenticated('patch', `/periodos/${created.body.id}`, 'admin-sub')
      .send({ nombre: 'No editable' })
      .expect(409);
  });
});
