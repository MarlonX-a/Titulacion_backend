import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { decodeJwt, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import type { CryptoKey } from 'jose';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { Test as SupertestTest } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthenticationService } from '../src/auth/authentication.service.js';
import type { AppEnvironment } from '../src/config/environment.js';
import { configureApplication } from '../src/config/setup-app.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { UsuarioEstado } from '../src/usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../src/usuarios/enums/usuario-rol.enum.js';
import { UsuariosService } from '../src/usuarios/usuarios.service.js';
import { PeriodoEstado } from '../src/periodos/enums/periodo-estado.enum.js';
import { CondicionIngreso } from '../src/habilitados/enums/condicion-ingreso.enum.js';
import { SituacionIngreso } from '../src/habilitados/enums/situacion-ingreso.enum.js';
import { HabilitadoEstado } from '../src/habilitados/enums/habilitado-estado.enum.js';
import { EstadoTema } from '../src/temas/enums/estado-tema.enum.js';
import { vi } from 'vitest';
import { NotificacionesPersistenciaService } from '../src/notificaciones/notificaciones-persistencia.service.js';
import { AsignacionTemaPersistenciaService } from '../src/asignaciones-tema/asignacion-tema-persistencia.service.js';
import { PostulacionPersistenciaService } from '../src/postulaciones/postulacion-persistencia.service.js';
import { GrupoIntegrantePersistenciaService } from '../src/grupos/grupo-integrante-persistencia.service.js';
import {
  addUsuarioTestRecord,
  clearUsuarioTestRecords,
  setPeriodoTestEstado,
  setPeriodoTestFechas,
  auditoriaTestRecords,
  habilitadosTestRecords,
  setPeriodoTestInicioTitulacion,
  setTemaTestEstado,
  findUsuarioTestIdByExternalId,
  DatabaseTestingModule,
} from './database-testing.module.js';

describe('Usuarios (e2e)', () => {
  let app: INestApplication<App>;
  let server: Server;
  let issuer: string;
  let privateKey: CryptoKey;
  let publicJwk: JWK;
  const tokens = new Map<string, string>();
  const avisosIngreso: Array<{ id: string; actorId: string; aviso: string }> = [];

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
    for (const subject of [
      'admin-sub',
      'student-sub',
      'docente-sub',
      'other-student-sub',
      'inactive-sub',
      'not-registered',
      'bootstrap-sub',
      'closed-condition-sub',
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
      AUTH_ISSUER: 'http://127.0.0.1:3000', AUTH_ORIGINS: [], REDIS_PORT: 6379, SMTP_PORT: 1025, S3_REGION: 'us-east-1',
      OUTBOX_ENCRYPTION_KEY_PATH: '.test-outbox-key',
    });
    writeFileSync(join(process.cwd(), '.test-outbox-key'), randomBytes(32));
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideModule(DatabaseModule)
      .useModule(DatabaseTestingModule)
      .overrideProvider(ConfigService)
      .useValue(config)
      .overrideProvider(AuthenticationService)
      .useValue({ verifyToken: async (token: string) => {
        const payload = decodeJwt(token);
        const externalSubject = typeof payload.sub === 'string' ? payload.sub : '';
        return { subject: findUsuarioTestIdByExternalId(externalSubject) ?? externalSubject, issuer: 'http://127.0.0.1:3000', firstAccess: false };
      } })
      .overrideProvider(NotificacionesPersistenciaService)
      .useValue({ ingreso: async (_manager: unknown, id: string, actorId: string, aviso = 'RESOLUCION') => { avisosIngreso.push({ id, actorId, aviso }); } })
      .compile();
    app = moduleFixture.createNestApplication<INestApplication<App>>();
    configureApplication(app);
    await app.init();
  });

  beforeEach(() => {
    clearUsuarioTestRecords();
    avisosIngreso.length = 0;
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
    server?.close();
    await once(server, 'close');
    const { unlinkSync } = await import('node:fs');
    unlinkSync(join(process.cwd(), '.test-outbox-key'));
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

  async function createPeriod(code = 'HABILITADOS-1') {
    return authenticated('post', '/periodos', 'admin-sub')
      .send({
        codigo: code,
        nombre: 'Período de prueba',
        fecha_inicio_postulacion: '2026-11-02T08:00:00-05:00',
        fecha_fin_postulacion: '2026-11-30T23:59:00-05:00',
        fecha_inicio_titulacion: '2026-12-01T08:00:00-05:00',
        max_integrantes_default: 5,
      })
      .expect(201);
  }

  async function createStudentProfile(subject = 'student-sub', cedula = '0102030400', matricula = 'H-1001') {
    const account = addUsuarioTestRecord({
      id_externo_sso: subject,
      email: `${matricula}@universidad.edu`,
      nombres: 'Estudiante',
      apellidos: 'Habilitado',
      rol: UsuarioRol.ESTUDIANTE,
    });
    const profile = await authenticated('post', '/estudiantes', 'admin-sub')
      .send({ usuario_id: account.id, cedula, matricula, carrera: 'Sistemas', nivel: 5 })
      .expect(201);
    return { account, profile };
  }

  it('crea usuarios solo por ADMIN y normaliza email y nombres', async () => {
    addAdmin();
    const response = await authenticated('post', '/usuarios', 'admin-sub')
      .send({
        email: '  Persona@LIVE.ULEAM.EDU.EC ',
        nombres: '  María Elena ',
        apellidos: ' Pérez ',
        rol: UsuarioRol.ESTUDIANTE,
      })
      .expect(201);

    expect(response.body).toMatchObject({
      email: 'persona@live.uleam.edu.ec',
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
    await authenticated(
      'get',
      '/auth/me',
      'not-registered',
    ).expect(403);
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

  it('rechaza correos duplicados y campos SSO obsoletos', async () => {
    addAdmin();
    const makeRequest = (email: string) =>
      authenticated('post', '/usuarios', 'admin-sub').send({
        email,
        nombres: 'Persona',
        apellidos: 'Prueba',
        rol: UsuarioRol.DOCENTE,
      });

    await makeRequest('nuevo@uleam.edu.ec').expect(201);
    await makeRequest('NUEVO@ULEAM.EDU.EC').expect(409);
    await authenticated('post', '/usuarios', 'admin-sub').send({ email: 'otro@uleam.edu.ec', nombres: 'Persona', apellidos: 'Prueba', rol: UsuarioRol.DOCENTE, id_externo_sso: 'removed' }).expect(400);
  });

  it('permite crear el primer ADMIN una sola vez ante solicitudes simultáneas', async () => {
    const usuarios = app.get(UsuariosService);
    const attempts = await Promise.allSettled([
      usuarios.createInitialAdmin({
        email: 'bootstrap@uleam.edu.ec',
        nombres: 'Admin',
        apellidos: 'Inicial',
        password: randomBytes(18).toString('base64url'),
      }),
      usuarios.createInitialAdmin({
        email: 'bootstrap-2@uleam.edu.ec',
        nombres: 'Admin',
        apellidos: 'Inicial',
        password: randomBytes(18).toString('base64url'),
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

  it('administra códigos únicos y períodos paginados; solo ADMIN los modifica', async () => {
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
    // todos los roles consultan períodos; solo ADMIN los modifica
    await authenticated('get', '/periodos', 'student-sub', 'ADMIN').expect(200);
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

  it('registra habilitaciones regulares y condicionadas y permite la consulta propia', async () => {
    addAdmin();
    const { profile } = await createStudentProfile();
    const period = await createPeriod();
    const regular = await authenticated(
      'post', `/periodos/${period.body.id}/habilitados`, 'admin-sub',
    ).send({ estudiante_id: profile.body.id, condicion_ingreso: CondicionIngreso.REGULAR })
      .expect(201);
    expect(regular.body).toMatchObject({
      periodo_id: period.body.id,
      estudiante_id: profile.body.id,
      origen: 'MANUAL',
      estado: 'HABILITADO',
      condicion_ingreso: CondicionIngreso.REGULAR,
      requisito_pendiente: null,
      situacion_ingreso: SituacionIngreso.ADMITIDO,
      resuelto_por_id: expect.any(String),
      estudiante: { id: profile.body.id, nombres: 'Estudiante', matricula: 'H-1001' },
    });
    expect(regular.body).not.toHaveProperty('estudiante.usuario.id_externo_sso');

    const { profile: secondProfile } = await createStudentProfile(
      'other-student-sub', '0102030418', 'H-1002',
    );
    const pending = await authenticated(
      'post', `/periodos/${period.body.id}/habilitados`, 'admin-sub',
    ).send({
      estudiante_id: secondProfile.body.id,
      condicion_ingreso: CondicionIngreso.CONDICIONADO,
      requisito_pendiente: '  Aprobar asignatura pendiente  ',
    }).expect(201);
    expect(pending.body).toMatchObject({
      situacion_ingreso: SituacionIngreso.PENDIENTE,
      requisito_pendiente: 'Aprobar asignatura pendiente',
    });
    expect(auditoriaTestRecords()).toHaveLength(2);

    const list = await authenticated(
      'get', `/periodos/${period.body.id}/habilitados?condicion_ingreso=REGULAR`, 'admin-sub',
    ).expect(200);
    expect(list.body).toMatchObject({ total: 1, page: 1, limit: 20 });
    expect(list.body.data[0].id).toBe(regular.body.id);
    await authenticated('get', `/periodos/${period.body.id}/habilitados/me`, 'student-sub')
      .expect(200)
      .then((response) => expect(response.body.id).toBe(regular.body.id));
    await authenticated('get', `/periodos/${period.body.id}/habilitados/${regular.body.id}`, 'admin-sub').expect(200);
    await authenticated('get', `/periodos/${period.body.id}/habilitados/me`, 'other-student-sub')
      .expect(200)
      .then((response) => expect(response.body.id).toBe(pending.body.id));
    await authenticated('get', `/periodos/${period.body.id}/habilitados/me`, 'docente-sub').expect(403);
    await authenticated('get', `/periodos/${period.body.id}/habilitados`, 'student-sub').expect(403);
  });

  it('valida altas condicionadas, duplicados, datos administrados y cuentas incompatibles', async () => {
    addAdmin();
    const { profile } = await createStudentProfile();
    const period = await createPeriod();
    const path = `/periodos/${period.body.id}/habilitados`;
    const conditional = {
      estudiante_id: profile.body.id,
      condicion_ingreso: CondicionIngreso.CONDICIONADO,
      requisito_pendiente: 'Aprobar asignatura',
    };
    await authenticated('post', path, 'admin-sub').send({
      estudiante_id: profile.body.id,
      condicion_ingreso: CondicionIngreso.CONDICIONADO,
    }).expect(400);
    await authenticated('post', path, 'admin-sub').send({ ...conditional, requisito_pendiente: ' ' }).expect(400);
    await authenticated('post', path, 'admin-sub').send({ ...conditional, estado: 'SUSPENDIDO' }).expect(400);
    const created = await authenticated('post', path, 'admin-sub').send(conditional).expect(201);
    expect(created.body).toMatchObject({
      situacion_ingreso: SituacionIngreso.PENDIENTE,
      requisito_pendiente: 'Aprobar asignatura',
      fecha_resolucion_ingreso: null,
      resuelto_por_id: null,
    });
    await authenticated('post', path, 'admin-sub').send(conditional).expect(409);
    await authenticated('get', `/periodos/${period.body.id}/habilitados/me`, 'other-student-sub').expect(403);
    await authenticated('get', `/periodos/${period.body.id}/habilitados?estado=INVALIDO`, 'admin-sub').expect(400);

    const { account: inactiveAccount, profile: inactiveProfile } = await createStudentProfile(
      'inactive-sub', '3002030405', 'H-1003',
    );
    inactiveAccount.estado = UsuarioEstado.INACTIVO;
    await authenticated('post', path, 'admin-sub').send({
      estudiante_id: inactiveProfile.body.id,
      condicion_ingreso: CondicionIngreso.REGULAR,
    }).expect(409);
  });

  it('resuelve condicionados una sola vez, conserva el requisito y registra auditoría atómica', async () => {
    const anular = vi.spyOn(app.get(AsignacionTemaPersistenciaService), 'anularPorIncumplimiento');
    const cancelarPostulaciones = vi.spyOn(app.get(PostulacionPersistenciaService), 'cancelarPendientesPorNoAdmision');
    const retirarGrupo = vi.spyOn(app.get(GrupoIntegrantePersistenciaService), 'retirarPorNoAdmision');
    addAdmin();
    const { profile } = await createStudentProfile();
    const period = await createPeriod();
    const created = await authenticated('post', `/periodos/${period.body.id}/habilitados`, 'admin-sub')
      .send({
        estudiante_id: profile.body.id,
        condicion_ingreso: CondicionIngreso.CONDICIONADO,
        requisito_pendiente: 'Completar prácticas',
      }).expect(201);
    await authenticated('post', `/periodos/${period.body.id}/habilitados/${created.body.id}/resolver-ingreso`, 'admin-sub')
      .send({ situacion_ingreso: SituacionIngreso.NO_ADMITIDO }).expect(400);
    const resolved = await authenticated('post', `/periodos/${period.body.id}/habilitados/${created.body.id}/resolver-ingreso`, 'admin-sub')
      .send({ situacion_ingreso: SituacionIngreso.ADMITIDO }).expect(200);
    expect(resolved.body).toMatchObject({
      situacion_ingreso: SituacionIngreso.ADMITIDO,
      requisito_pendiente: 'Completar prácticas',
      resuelto_por_id: expect.any(String),
    });
    await authenticated('post', `/periodos/${period.body.id}/habilitados/${created.body.id}/resolver-ingreso`, 'admin-sub')
      .send({ situacion_ingreso: SituacionIngreso.NO_ADMITIDO, observacion_ingreso: 'Resolución tardía' }).expect(409);
    expect(auditoriaTestRecords()).toHaveLength(2);
    expect(auditoriaTestRecords()[1].valores_anteriores?.situacion_ingreso).toBe(SituacionIngreso.PENDIENTE);
    expect(auditoriaTestRecords()[1].ip_origen).toBeTruthy();

    const { profile: secondProfile } = await createStudentProfile(
      'other-student-sub', '0102030418', 'H-1002',
    );
    const second = await authenticated('post', `/periodos/${period.body.id}/habilitados`, 'admin-sub')
      .send({ estudiante_id: secondProfile.body.id, condicion_ingreso: CondicionIngreso.CONDICIONADO, requisito_pendiente: 'Completar prácticas' })
      .expect(201);
    const rejected = await authenticated('post', `/periodos/${period.body.id}/habilitados/${second.body.id}/resolver-ingreso`, 'admin-sub')
      .send({ situacion_ingreso: SituacionIngreso.NO_ADMITIDO, observacion_ingreso: 'No completó el requisito.' })
      .expect(200);
    expect(rejected.body).toMatchObject({
      situacion_ingreso: SituacionIngreso.NO_ADMITIDO,
      observacion_ingreso: 'No completó el requisito.',
      estado: 'HABILITADO',
    });
    expect(auditoriaTestRecords()).toHaveLength(4);
    expect(anular).toHaveBeenCalledTimes(1);
    expect(anular).toHaveBeenCalledWith(
      expect.anything(), period.body.id, secondProfile.body.id, expect.objectContaining({ rol: UsuarioRol.ADMIN }), 'No completó el requisito.', expect.any(String),
    );
    // La NO_ADMISIÓN también cancela postulaciones pendientes y retira del grupo activo, en la misma transacción y en orden.
    for (const effect of [cancelarPostulaciones, retirarGrupo]) {
      expect(effect).toHaveBeenCalledTimes(1);
      expect(effect).toHaveBeenCalledWith(
        anular.mock.calls[0]![0], period.body.id, secondProfile.body.id, expect.objectContaining({ rol: UsuarioRol.ADMIN }), 'No completó el requisito.', expect.any(String),
      );
    }
    expect(anular.mock.invocationCallOrder[0]).toBeLessThan(cancelarPostulaciones.mock.invocationCallOrder[0]!);
    expect(cancelarPostulaciones.mock.invocationCallOrder[0]).toBeLessThan(retirarGrupo.mock.invocationCallOrder[0]!);
    await expect(cancelarPostulaciones.mock.results[0]!.value).resolves.toEqual([]);
    await expect(retirarGrupo.mock.results[0]!.value).resolves.toEqual({ resultado: 'SIN_GRUPO' });
    expect(avisosIngreso).toContainEqual({ id: second.body.id, actorId: expect.any(String), aviso: 'RESOLUCION' });
  });

  it('requiere períodos BORRADOR para altas y resoluciones, y refleja la API en Swagger', async () => {
    addAdmin();
    const { profile } = await createStudentProfile();
    const period = await createPeriod();
    const created = await authenticated('post', `/periodos/${period.body.id}/habilitados`, 'admin-sub')
      .send({ estudiante_id: profile.body.id, condicion_ingreso: CondicionIngreso.CONDICIONADO, requisito_pendiente: 'Completar prácticas' })
      .expect(201);
    setPeriodoTestEstado(period.body.id, PeriodoEstado.POSTULACION_ABIERTA);
    await authenticated('post', `/periodos/${period.body.id}/habilitados`, 'admin-sub')
      .send({ estudiante_id: profile.body.id, condicion_ingreso: CondicionIngreso.REGULAR }).expect(409);
    await authenticated('post', `/periodos/${period.body.id}/habilitados/${created.body.id}/resolver-ingreso`, 'admin-sub')
      .send({ situacion_ingreso: SituacionIngreso.ADMITIDO }).expect(200);
    await authenticated('post', `/periodos/${period.body.id}/habilitados/${created.body.id}/resolver-ingreso`, 'admin-sub')
      .send({ situacion_ingreso: SituacionIngreso.ADMITIDO }).expect(409);
    const docs = await request(app.getHttpServer()).get('/docs-json').expect(200);
    expect(docs.body.components.schemas.HabilitadoResponseDto).toBeDefined();
    expect(docs.body.paths[`/periodos/{periodoId}/habilitados/me`].get).toBeDefined();
  });

  it('vuelve a habilitar como condicionado a un estudiante SUSPENDIDO del período', async () => {
    addAdmin();
    const { profile } = await createStudentProfile();
    const period = await createPeriod();
    const created = await authenticated('post', `/periodos/${period.body.id}/habilitados`, 'admin-sub')
      .send({ estudiante_id: profile.body.id, condicion_ingreso: CondicionIngreso.REGULAR })
      .expect(201);
    await authenticated('post', `/periodos/${period.body.id}/habilitados`, 'admin-sub')
      .send({ estudiante_id: profile.body.id, condicion_ingreso: CondicionIngreso.REGULAR }).expect(409);
    const row = habilitadosTestRecords().find((item) => item.id === created.body.id);
    if (!row) throw new Error('No se creó la habilitación de prueba.');
    row.estado = HabilitadoEstado.SUSPENDIDO;
    row.situacion_ingreso = SituacionIngreso.NO_ADMITIDO;

    const reactivated = await authenticated('post', `/periodos/${period.body.id}/habilitados`, 'admin-sub')
      .send({ estudiante_id: profile.body.id, condicion_ingreso: CondicionIngreso.CONDICIONADO, requisito_pendiente: 'Rendir examen de inglés' })
      .expect(201);
    expect(reactivated.body).toMatchObject({
      id: created.body.id,
      estado: HabilitadoEstado.HABILITADO,
      condicion_ingreso: CondicionIngreso.CONDICIONADO,
      requisito_pendiente: 'Rendir examen de inglés',
      situacion_ingreso: SituacionIngreso.PENDIENTE,
    });
    expect(auditoriaTestRecords().map((entry) => entry.accion)).toContain('REACTIVAR_HABILITACION');
  });

  it('administra líneas y aplica visibilidad por rol, normalización y auditoría', async () => {
    addAdmin();
    addUsuarioTestRecord({ id_externo_sso: 'docente-sub', email: 'docente@universidad.edu', nombres: 'Docente', apellidos: 'Prueba', rol: UsuarioRol.DOCENTE });
    addUsuarioTestRecord({ id_externo_sso: 'student-sub', email: 'estudiante@universidad.edu', nombres: 'Estudiante', apellidos: 'Prueba', rol: UsuarioRol.ESTUDIANTE });

    const created = await authenticated('post', '/lineas-investigacion', 'admin-sub')
      .send({ codigo: '  IA  ', nombre: '  Inteligencia artificial ', descripcion: ' Sistemas inteligentes ' })
      .expect(201);
    expect(created.body).toMatchObject({ codigo: 'IA', nombre: 'Inteligencia artificial', descripcion: 'Sistemas inteligentes', activa: true });
    expect(auditoriaTestRecords()).toHaveLength(1);

    const duplicate = await authenticated('post', '/lineas-investigacion', 'admin-sub')
      .send({ codigo: 'IA', nombre: 'Otro nombre válido' }).expect(409);
    expect(duplicate.body.message).not.toContain('SQL');
    await authenticated('post', '/lineas-investigacion', 'admin-sub').send({ codigo: ' ', nombre: 'Vacío' }).expect(400);
    await authenticated('post', '/lineas-investigacion', 'admin-sub').send({ codigo: 'C'.repeat(21), nombre: 'Código largo' }).expect(400);
    await authenticated('post', '/lineas-investigacion', 'admin-sub').send({ codigo: 'NOMBRE-LARGO', nombre: 'N'.repeat(151) }).expect(400);
    await authenticated('post', '/lineas-investigacion', 'admin-sub').send({ codigo: 'OTRA', nombre: 'Válida', activa: false }).expect(400);
    await authenticated('post', '/lineas-investigacion', 'admin-sub').send({ codigo: 'OTRA', nombre: 'Válida', descripcion: null }).expect(400);

    const noOp = await authenticated('patch', `/lineas-investigacion/${created.body.id}`, 'admin-sub')
      .send({ nombre: 'Inteligencia artificial' }).expect(200);
    expect(noOp.body).toMatchObject({ id: created.body.id, activa: true });
    expect(auditoriaTestRecords()).toHaveLength(1);
    await authenticated('patch', `/lineas-investigacion/${created.body.id}`, 'admin-sub').send({}).expect(400);
    await authenticated('patch', `/lineas-investigacion/${created.body.id}`, 'admin-sub').send({ activa: 'false' }).expect(400);
    await authenticated('patch', `/lineas-investigacion/${created.body.id}`, 'admin-sub').send({ codigo: null }).expect(400);
    await authenticated('patch', `/lineas-investigacion/${created.body.id}`, 'admin-sub').send({ desconocido: true }).expect(400);

    const inactive = await authenticated('patch', `/lineas-investigacion/${created.body.id}`, 'admin-sub')
      .send({ activa: false, descripcion: null }).expect(200);
    expect(inactive.body).toMatchObject({ activa: false, descripcion: null });
    expect(auditoriaTestRecords()).toHaveLength(2);
    const adminList = await authenticated('get', '/lineas-investigacion', 'admin-sub').expect(200);
    expect(adminList.body).toMatchObject({ total: 1, page: 1, limit: 20 });
    expect(adminList.body.data[0].activa).toBe(false);
    await authenticated('get', '/lineas-investigacion?activa=false', 'docente-sub').expect(403);
    await authenticated('get', '/lineas-investigacion?activa=FALSE', 'admin-sub').expect(400);
    await authenticated('get', `/lineas-investigacion/${created.body.id}`, 'docente-sub').expect(404);
    await authenticated('get', '/lineas-investigacion', 'student-sub').expect(200).then((result) => expect(result.body.total).toBe(0));
    await authenticated('patch', `/lineas-investigacion/${created.body.id}`, 'admin-sub').send({ activa: true }).expect(200);
    await authenticated('get', `/lineas-investigacion/${created.body.id}`, 'docente-sub').expect(200);
    await authenticated('post', '/lineas-investigacion', 'docente-sub').send({ codigo: 'DOC', nombre: 'No autorizado' }).expect(403);

    const inactiveAccount = addUsuarioTestRecord({ id_externo_sso: 'inactive-sub', email: 'inactive@universidad.edu', nombres: 'Inactivo', apellidos: 'Prueba', rol: UsuarioRol.DOCENTE });
    inactiveAccount.estado = UsuarioEstado.INACTIVO;
    await authenticated('get', '/lineas-investigacion', 'inactive-sub').expect(403);

    const docs = await request(app.getHttpServer()).get('/docs-json').expect(200);
    expect(docs.body.components.schemas.LineaInvestigacionResponseDto).toBeDefined();
    expect(docs.body.paths['/lineas-investigacion'].post).toBeDefined();
    expect(docs.body.paths['/lineas-investigacion/{id}'].patch).toBeDefined();
  });

  it('administra temas en borrador, filtra por docente y conserva historial', async () => {
    addAdmin();
    const teacher = addUsuarioTestRecord({ id_externo_sso: 'docente-sub', email: 'docente@universidad.edu', nombres: 'Docente', apellidos: 'Proponente', rol: UsuarioRol.DOCENTE });
    const teacherProfile = await authenticated('post', '/docentes', 'admin-sub').send({ usuario_id: teacher.id, cedula: '3002030405', titulo_academico: 'Magíster', departamento: 'Sistemas' }).expect(201);
    const line = await authenticated('post', '/lineas-investigacion', 'admin-sub').send({ codigo: 'IA', nombre: 'Inteligencia artificial' }).expect(201);
    const period = await createPeriod('TEMAS-1');
    const path = `/periodos/${period.body.id}/temas`;
    const created = await authenticated('post', path, 'admin-sub').send({
      linea_id: line.body.id,
      docente_proponente_id: teacherProfile.body.id,
      titulo: '  Sistema de recomendación  ',
      descripcion: '  Descripción del tema  ',
      min_integrantes: 1,
      max_integrantes: 3,
    }).expect(201);
    expect(created.body).toMatchObject({ estado: 'BORRADOR', titulo: 'Sistema de recomendación', descripcion: 'Descripción del tema', min_integrantes: 1, max_integrantes: 3, linea: { id: line.body.id }, docente_proponente: { id: teacherProfile.body.id, nombres: 'Docente' } });
    expect(created.body).not.toHaveProperty('docente_proponente.usuario');

    await authenticated('get', path, 'docente-sub').expect(200).then((response) => {
      expect(response.body.total).toBe(1);
      expect(response.body.data[0].id).toBe(created.body.id);
    });
    await authenticated('get', `${path}/${created.body.id}`, 'docente-sub').expect(200);
    await authenticated('get', `${path}/${created.body.id}/historial`, 'admin-sub').expect(200).then((response) => {
      expect(response.body.total).toBe(1);
      expect(response.body.data[0]).toMatchObject({ estado_anterior: null, estado_nuevo: 'BORRADOR' });
    });
    const noOp = await authenticated('patch', `${path}/${created.body.id}`, 'admin-sub').send({ titulo: 'Sistema de recomendación' }).expect(200);
    expect(noOp.body.id).toBe(created.body.id);
    await authenticated('patch', `${path}/${created.body.id}`, 'admin-sub').send({ max_integrantes: 4 }).expect(200);
    await authenticated('get', `${path}/${created.body.id}/historial`, 'admin-sub').expect(200).then((response) => expect(response.body.total).toBe(2));

    await authenticated('post', path, 'admin-sub').send({ ...created.body, id: created.body.id, estado: 'PUBLICADO' }).expect(400);
    await authenticated('post', path, 'admin-sub').send({ linea_id: line.body.id, docente_proponente_id: teacherProfile.body.id, titulo: 'Inválido', descripcion: 'Inválido', min_integrantes: 3, max_integrantes: 2 }).expect(400);
    await authenticated('post', path, 'admin-sub').send({ linea_id: line.body.id, docente_proponente_id: teacherProfile.body.id, titulo: 'Número como texto', descripcion: 'Inválido', min_integrantes: '1', max_integrantes: 2 }).expect(400);
    await authenticated('patch', `${path}/${created.body.id}`, 'admin-sub').send({}).expect(400);
    await authenticated('get', `${path}/${created.body.id}/historial`, 'docente-sub').expect(403);
    await authenticated('get', path, 'student-sub').expect(403);
    await authenticated('patch', `${path}/${created.body.id}`, 'docente-sub').send({ titulo: 'No autorizado' }).expect(403);
    await authenticated('patch', `/lineas-investigacion/${line.body.id}`, 'admin-sub').send({ activa: false }).expect(200);
    await authenticated('post', path, 'admin-sub').send({ linea_id: line.body.id, docente_proponente_id: teacherProfile.body.id, titulo: 'Línea inactiva', descripcion: 'No debe crear', min_integrantes: 1, max_integrantes: 1 }).expect(409);
    await authenticated('patch', `/lineas-investigacion/${line.body.id}`, 'admin-sub').send({ activa: true }).expect(200);
    const inactiveTeacher = addUsuarioTestRecord({ id_externo_sso: 'bootstrap-sub', email: 'inactivo@universidad.edu', nombres: 'Docente', apellidos: 'Inactivo', rol: UsuarioRol.DOCENTE });
    const inactiveTeacherProfile = await authenticated('post', '/docentes', 'admin-sub').send({ usuario_id: inactiveTeacher.id, cedula: '0102030418', titulo_academico: 'Magíster', departamento: 'Sistemas' }).expect(201);
    inactiveTeacher.estado = UsuarioEstado.INACTIVO;
    await authenticated('post', path, 'admin-sub').send({ linea_id: line.body.id, docente_proponente_id: inactiveTeacherProfile.body.id, titulo: 'Docente inactivo', descripcion: 'No debe crear', min_integrantes: 1, max_integrantes: 1 }).expect(409);
    await authenticated('post', path, 'admin-sub').send({ linea_id: line.body.id, docente_proponente_id: '00000000-0000-4000-8000-000000000001', titulo: 'Docente inexistente', descripcion: 'No debe crear', min_integrantes: 1, max_integrantes: 1 }).expect(404);

    const oldRefsUser = addUsuarioTestRecord({ id_externo_sso: 'other-student-sub', email: 'referencia-anterior@universidad.edu', nombres: 'Docente', apellidos: 'Anterior', rol: UsuarioRol.DOCENTE });
    const oldRefsTeacher = await authenticated('post', '/docentes', 'admin-sub').send({ usuario_id: oldRefsUser.id, cedula: '0102030400', titulo_academico: 'Magíster', departamento: 'Sistemas' }).expect(201);
    const replacementLine = await authenticated('post', '/lineas-investigacion', 'admin-sub').send({ codigo: 'IA2', nombre: 'Inteligencia artificial aplicada' }).expect(201);
    const referencesTopic = await authenticated('post', path, 'admin-sub').send({ linea_id: line.body.id, docente_proponente_id: oldRefsTeacher.body.id, titulo: 'Cambio conjunto de referencias', descripcion: 'Tema de prueba', min_integrantes: 1, max_integrantes: 2 }).expect(201);
    await authenticated('patch', `/lineas-investigacion/${line.body.id}`, 'admin-sub').send({ activa: false }).expect(200);
    oldRefsUser.estado = UsuarioEstado.INACTIVO;
    await authenticated('patch', `${path}/${referencesTopic.body.id}`, 'admin-sub').send({ linea_id: replacementLine.body.id, docente_proponente_id: teacherProfile.body.id }).expect(200);

    const docs = await request(app.getHttpServer()).get('/docs-json').expect(200);
    expect(docs.body.components.schemas.TemaResponseDto).toBeDefined();
    expect(docs.body.paths['/periodos/{periodoId}/temas'].post).toBeDefined();
    expect(docs.body.paths['/periodos/{periodoId}/temas/{id}/historial'].get).toBeDefined();
    expect(docs.body.paths['/periodos/{periodoId}/temas/{id}/publicar'].post).toBeDefined();
    expect(docs.body.paths['/periodos/{id}/abrir-postulacion'].post).toBeDefined();
    expect(docs.body.paths['/periodos/{id}/abrir-postulacion'].post.responses['200']).toBeDefined();
    expect(docs.body.paths['/periodos/{id}/cerrar-postulacion'].post).toBeDefined();
    expect(docs.body.paths['/periodos/{periodoId}/temas/{id}/cerrar'].post).toBeDefined();
    expect(docs.body.paths['/periodos/{periodoId}/temas/{id}/retirar'].post).toBeDefined();
    expect(docs.body.paths['/periodos/{periodoId}/asignaciones-tema/{id}/anular'].post).toBeDefined();
    expect(docs.body.paths['/periodos/{id}/iniciar-titulacion'].post.responses['200']).toBeDefined();
    expect(docs.body.paths['/periodos/{periodoId}/conflictos'].get).toBeDefined();
    expect(docs.body.paths['/periodos/{periodoId}/temas/{temaId}/conflicto/resolver'].post).toBeDefined();
  });

  it('abre períodos dentro del plazo, publica temas y muestra el catálogo a estudiantes habilitados', async () => {
    addAdmin();
    addUsuarioTestRecord({ id_externo_sso: 'not-registered', email: 'sin-perfil@universidad.edu', nombres: 'Sin', apellidos: 'Perfil', rol: UsuarioRol.ESTUDIANTE });
    const student = await createStudentProfile();
    await createStudentProfile('other-student-sub', '0102030418', 'CAT-1002');
    const pendingForClose = await createStudentProfile('closed-condition-sub', '0102030459', 'CAT-1005');
    const studentNotAdmitted = await createStudentProfile('bootstrap-sub', '0102030426', 'CAT-1003');
    const studentSuspended = await createStudentProfile('inactive-sub', '0102030434', 'CAT-1004');
    const teacher = addUsuarioTestRecord({ id_externo_sso: 'docente-sub', email: 'docente@universidad.edu', nombres: 'Docente', apellidos: 'Proponente', rol: UsuarioRol.DOCENTE });
    const teacherProfile = await authenticated('post', '/docentes', 'admin-sub').send({ usuario_id: teacher.id, cedula: '3002030405', titulo_academico: 'Magíster', departamento: 'Sistemas' }).expect(201);
    const line = await authenticated('post', '/lineas-investigacion', 'admin-sub').send({ codigo: 'CAT-IA', nombre: 'Inteligencia artificial' }).expect(201);
    const period = await createPeriod('CATALOGO-1');
    const start = new Date(Date.now() - 60_000);
    const end = new Date(Date.now() + 60 * 60_000);
    const titulation = new Date(end.getTime() + 60 * 60_000);
    await authenticated('patch', `/periodos/${period.body.id}`, 'admin-sub').send({
      fecha_inicio_postulacion: start.toISOString(),
      fecha_fin_postulacion: end.toISOString(),
      fecha_inicio_titulacion: titulation.toISOString(),
    }).expect(200);
    const habilitation = await authenticated('post', `/periodos/${period.body.id}/habilitados`, 'admin-sub')
      .send({ estudiante_id: student.profile.body.id, condicion_ingreso: CondicionIngreso.CONDICIONADO, requisito_pendiente: 'Completar requisito' })
      .expect(201);
    const deniedHabilitation = await authenticated('post', `/periodos/${period.body.id}/habilitados`, 'admin-sub')
      .send({ estudiante_id: studentNotAdmitted.profile.body.id, condicion_ingreso: CondicionIngreso.REGULAR })
      .expect(201);
    const suspendedHabilitation = await authenticated('post', `/periodos/${period.body.id}/habilitados`, 'admin-sub')
      .send({ estudiante_id: studentSuspended.profile.body.id, condicion_ingreso: CondicionIngreso.REGULAR })
      .expect(201);
    const conditionalAfterClose = await authenticated('post', `/periodos/${period.body.id}/habilitados`, 'admin-sub')
      .send({ estudiante_id: pendingForClose.profile.body.id, condicion_ingreso: CondicionIngreso.CONDICIONADO, requisito_pendiente: 'Resolver después del cierre' })
      .expect(201);
    const habilitationRecords = habilitadosTestRecords();
    const notAdmittedRecord = habilitationRecords.find((record) => record.id === deniedHabilitation.body.id);
    const suspendedRecord = habilitationRecords.find((record) => record.id === suspendedHabilitation.body.id);
    if (!notAdmittedRecord || !suspendedRecord) throw new Error('No se encontraron habilitaciones preparadas para las pruebas de acceso.');
    notAdmittedRecord.situacion_ingreso = SituacionIngreso.NO_ADMITIDO;
    suspendedRecord.estado = HabilitadoEstado.SUSPENDIDO;
    const themesPath = `/periodos/${period.body.id}/temas`;
    const tema = await authenticated('post', themesPath, 'admin-sub').send({
      linea_id: line.body.id,
      docente_proponente_id: teacherProfile.body.id,
      titulo: 'Tema de catálogo',
      descripcion: 'Descripción de catálogo',
      min_integrantes: 2,
      max_integrantes: 4,
    }).expect(201);

    await authenticated('post', `${themesPath}/${tema.body.id}/publicar`, 'admin-sub').send({ estado: 'PUBLICADO' }).expect(400);
    const published = await authenticated('post', `${themesPath}/${tema.body.id}/publicar`, 'admin-sub').expect(200);
    expect(published.body.estado).toBe('PUBLICADO');
    await authenticated('post', `${themesPath}/${tema.body.id}/publicar`, 'admin-sub').expect(409);
    await authenticated('post', `${themesPath}/${tema.body.id}/publicar`, 'docente-sub').expect(403);
    await authenticated('get', themesPath, 'student-sub').expect(403);

    await authenticated('post', `/periodos/${period.body.id}/abrir-postulacion`, 'admin-sub').send({ estado: 'POSTULACION_ABIERTA' }).expect(400);
    const opened = await authenticated('post', `/periodos/${period.body.id}/abrir-postulacion`, 'admin-sub').expect(200);
    expect(opened.body.estado).toBe(PeriodoEstado.POSTULACION_ABIERTA);
    await authenticated('post', `/periodos/${period.body.id}/abrir-postulacion`, 'admin-sub').expect(409);
    await authenticated('post', `/periodos/${period.body.id}/cerrar-postulacion`, 'admin-sub').expect(409);
    const studentCatalog = await authenticated('get', `${themesPath}?num_integrantes=3`, 'student-sub').expect(200);
    expect(studentCatalog.body).toMatchObject({ total: 1, data: [{ id: tema.body.id, estado: 'PUBLICADO' }] });
    await authenticated('get', themesPath, 'other-student-sub').expect(403);
    await authenticated('get', themesPath, 'bootstrap-sub').expect(403);
    await authenticated('get', themesPath, 'inactive-sub').expect(403);
    await authenticated('get', themesPath, 'not-registered').expect(403);
    await authenticated('get', `${themesPath}?num_integrantes=5`, 'student-sub').expect(200).then((response) => expect(response.body.total).toBe(0));
    await authenticated('get', `${themesPath}?estado=BORRADOR`, 'student-sub').expect(403);
    await authenticated('get', `${themesPath}/${tema.body.id}`, 'student-sub').expect(200);
    const draftAfterOpening = await authenticated('post', themesPath, 'admin-sub').send({
      linea_id: line.body.id, docente_proponente_id: teacherProfile.body.id,
      titulo: 'Borrador todavía oculto', descripcion: 'Tema no publicado', min_integrantes: 1, max_integrantes: 2,
    }).expect(201);
    await authenticated('get', `${themesPath}/${draftAfterOpening.body.id}`, 'student-sub').expect(404);
    await authenticated('get', `${themesPath}/${tema.body.id}/historial`, 'admin-sub').expect(200).then((response) => {
      expect(response.body.data.map((item: { estado_anterior: string | null; estado_nuevo: string }) => [item.estado_anterior, item.estado_nuevo])).toEqual([
        [null, 'BORRADOR'], ['BORRADOR', 'PUBLICADO'],
      ]);
    });
    expect(auditoriaTestRecords().map((entry) => entry.accion)).toContain('ABRIR_POSTULACION');
    expect(auditoriaTestRecords().map((entry) => entry.accion)).toContain('PUBLICAR_TEMA');
    expect(habilitation.body.situacion_ingreso).toBe(SituacionIngreso.PENDIENTE);
    await authenticated('post', `/periodos/${period.body.id}/habilitados/${habilitation.body.id}/resolver-ingreso`, 'admin-sub')
      .send({ situacion_ingreso: SituacionIngreso.ADMITIDO }).expect(200);
    setPeriodoTestFechas(period.body.id, new Date(Date.now() - 2 * 60 * 60_000), new Date(Date.now() - 60 * 60_000));
    await authenticated('post', `/periodos/${period.body.id}/cerrar-postulacion`, 'admin-sub').expect(200).then((response) => expect(response.body.estado).toBe(PeriodoEstado.POSTULACION_CERRADA));
    await authenticated('post', `/periodos/${period.body.id}/cerrar-postulacion`, 'admin-sub').expect(409);
    await authenticated('post', `/periodos/${period.body.id}/habilitados/${conditionalAfterClose.body.id}/resolver-ingreso`, 'admin-sub')
      .send({ situacion_ingreso: SituacionIngreso.ADMITIDO }).expect(200);
    await authenticated('get', themesPath, 'student-sub').expect(403);
    await authenticated('get', themesPath, 'admin-sub').expect(200).then((response) => expect(response.body.total).toBe(2));
  });

  it('rechaza abrir fuera del plazo y rechaza publicaciones y escrituras luego del vencimiento', async () => {
    addAdmin();
    const teacher = addUsuarioTestRecord({ id_externo_sso: 'docente-sub', email: 'docente@universidad.edu', nombres: 'Docente', apellidos: 'Proponente', rol: UsuarioRol.DOCENTE });
    const teacherProfile = await authenticated('post', '/docentes', 'admin-sub').send({ usuario_id: teacher.id, cedula: '3002030405', titulo_academico: 'Magíster', departamento: 'Sistemas' }).expect(201);
    const line = await authenticated('post', '/lineas-investigacion', 'admin-sub').send({ codigo: 'CAT-IA', nombre: 'Inteligencia artificial' }).expect(201);
    const period = await createPeriod('CATALOGO-FUERA-PLAZO');
    await authenticated('post', `/periodos/${period.body.id}/abrir-postulacion`, 'admin-sub').expect(409);
    const expiredPeriod = await createPeriod('CATALOGO-VENCIDO');
    const expiredStart = new Date(Date.now() - 2 * 60 * 60_000);
    const expiredEnd = new Date(Date.now() - 60 * 60_000);
    await authenticated('patch', `/periodos/${expiredPeriod.body.id}`, 'admin-sub').send({
      fecha_inicio_postulacion: expiredStart.toISOString(),
      fecha_fin_postulacion: expiredEnd.toISOString(),
      fecha_inicio_titulacion: new Date(expiredEnd.getTime() + 60_000).toISOString(),
    }).expect(200);
    await authenticated('post', `/periodos/${expiredPeriod.body.id}/abrir-postulacion`, 'admin-sub').expect(409);
    const tema = await authenticated('post', `/periodos/${period.body.id}/temas`, 'admin-sub').send({
      linea_id: line.body.id, docente_proponente_id: teacherProfile.body.id, titulo: 'Tema', descripcion: 'Descripción', min_integrantes: 1, max_integrantes: 2,
    }).expect(201);
    setPeriodoTestEstado(period.body.id, PeriodoEstado.POSTULACION_ABIERTA);
    setPeriodoTestFechas(period.body.id, new Date(Date.now() - 60 * 60_000), new Date(Date.now() - 1_000));
    await authenticated('patch', `/periodos/${period.body.id}/temas/${tema.body.id}`, 'admin-sub').send({ titulo: 'Editado' }).expect(409);
    await authenticated('post', `/periodos/${period.body.id}/temas`, 'admin-sub').send({
      linea_id: line.body.id, docente_proponente_id: teacherProfile.body.id, titulo: 'Fuera de plazo', descripcion: 'No debe crearse', min_integrantes: 1, max_integrantes: 2,
    }).expect(409);
    await authenticated('post', `/periodos/${period.body.id}/temas/${tema.body.id}/publicar`, 'admin-sub').expect(409);
  });

  async function createOpenTopic(code: string) {
    const teacher = addUsuarioTestRecord({ id_externo_sso: 'docente-sub', email: 'docente@universidad.edu', nombres: 'Docente', apellidos: 'Proponente', rol: UsuarioRol.DOCENTE });
    const teacherProfile = await authenticated('post', '/docentes', 'admin-sub').send({ usuario_id: teacher.id, cedula: '3002030405', titulo_academico: 'Magíster', departamento: 'Sistemas' }).expect(201);
    const line = await authenticated('post', '/lineas-investigacion', 'admin-sub').send({ codigo: `${code}-L`, nombre: 'Línea de prueba' }).expect(201);
    const period = await createPeriod(code);
    const start = new Date(Date.now() - 60_000);
    const end = new Date(Date.now() + 60 * 60_000);
    await authenticated('patch', `/periodos/${period.body.id}`, 'admin-sub').send({
      fecha_inicio_postulacion: start.toISOString(),
      fecha_fin_postulacion: end.toISOString(),
      fecha_inicio_titulacion: new Date(end.getTime() + 60 * 60_000).toISOString(),
    }).expect(200);
    const themesPath = `/periodos/${period.body.id}/temas`;
    const topic = await authenticated('post', themesPath, 'admin-sub').send({
      linea_id: line.body.id, docente_proponente_id: teacherProfile.body.id,
      titulo: 'Tema administrable', descripcion: 'Descripción', min_integrantes: 1, max_integrantes: 3,
    }).expect(201);
    return { period, themesPath, topic };
  }

  it('cierra, reabre y retira temas con motivo, historial y auditoría (RF-21/RF-25)', async () => {
    addAdmin();
    const { period, themesPath, topic } = await createOpenTopic('TEMAS-CIERRE');
    const topicPath = `${themesPath}/${topic.body.id}`;
    await authenticated('post', `${topicPath}/cerrar`, 'admin-sub').send({ motivo: 'Borrador' }).expect(409);
    await authenticated('post', `${topicPath}/publicar`, 'admin-sub').expect(200);

    await authenticated('post', `${topicPath}/cerrar`, 'admin-sub').send({}).expect(400);
    await authenticated('post', `${topicPath}/cerrar`, 'admin-sub').send({ motivo: '   ' }).expect(400);
    await authenticated('post', `${topicPath}/cerrar`, 'docente-sub').send({ motivo: 'Sin permiso' }).expect(403);
    const closed = await authenticated('post', `${topicPath}/cerrar`, 'admin-sub').send({ motivo: 'Cupo cubierto' }).expect(200);
    expect(closed.body.estado).toBe(EstadoTema.CERRADO);
    await authenticated('post', `${topicPath}/cerrar`, 'admin-sub').send({ motivo: 'Otra vez' }).expect(409);

    setPeriodoTestEstado(period.body.id, PeriodoEstado.POSTULACION_CERRADA);
    const reopened = await authenticated('post', `${topicPath}/publicar`, 'admin-sub').expect(200);
    expect(reopened.body.estado).toBe(EstadoTema.PUBLICADO);

    setTemaTestEstado(topic.body.id, EstadoTema.ASIGNADO);
    await authenticated('post', `${topicPath}/cerrar`, 'admin-sub').send({ motivo: 'Asignado' }).expect(409);
    await authenticated('post', `${topicPath}/retirar`, 'admin-sub').send({ motivo: 'Asignado' }).expect(409);
    setTemaTestEstado(topic.body.id, EstadoTema.PUBLICADO);

    setPeriodoTestEstado(period.body.id, PeriodoEstado.ARCHIVADO);
    await authenticated('post', `${topicPath}/retirar`, 'admin-sub').send({ motivo: 'Archivado' }).expect(409);
    setPeriodoTestEstado(period.body.id, PeriodoEstado.POSTULACION_CERRADA);

    const withdrawn = await authenticated('post', `${topicPath}/retirar`, 'admin-sub').send({ motivo: 'Docente no disponible' }).expect(200);
    expect(withdrawn.body.estado).toBe(EstadoTema.RETIRADO);
    await authenticated('post', `${topicPath}/retirar`, 'admin-sub').send({ motivo: 'Otra vez' }).expect(409);
    await authenticated('post', `${topicPath}/publicar`, 'admin-sub').expect(409);

    await authenticated('get', `${topicPath}/historial`, 'admin-sub').expect(200).then((response) => {
      expect(response.body.data.map((item: { estado_anterior: string | null; estado_nuevo: string }) => [item.estado_anterior, item.estado_nuevo])).toEqual([
        [null, 'BORRADOR'], ['BORRADOR', 'PUBLICADO'], ['PUBLICADO', 'CERRADO'], ['CERRADO', 'PUBLICADO'], ['PUBLICADO', 'RETIRADO'],
      ]);
      expect(response.body.data[2].cambios.motivo).toBe('Cupo cubierto');
    });
    expect(auditoriaTestRecords().map((entry) => entry.accion)).toEqual(expect.arrayContaining(['CERRAR_TEMA', 'REABRIR_TEMA', 'RETIRAR_TEMA']));
  });

  it('valida la anulación manual de asignaciones: DTO, rol, existencia y período ARCHIVADO', async () => {
    addAdmin();
    addUsuarioTestRecord({ id_externo_sso: 'docente-sub', email: 'docente@universidad.edu', nombres: 'Docente', apellidos: 'Proponente', rol: UsuarioRol.DOCENTE });
    const period = await createPeriod('ANULAR-1');
    const annulPath = `/periodos/${period.body.id}/asignaciones-tema/00000000-0000-4000-8000-000000000001/anular`;
    await authenticated('post', annulPath, 'admin-sub').send({ causa: 'DESCONOCIDA', motivo: 'Motivo' }).expect(400);
    await authenticated('post', annulPath, 'admin-sub').send({ causa: 'OTRA', motivo: '  ' }).expect(400);
    await authenticated('post', annulPath, 'docente-sub').send({ causa: 'OTRA', motivo: 'Motivo' }).expect(403);
    await authenticated('post', annulPath, 'admin-sub').send({ causa: 'OTRA', motivo: 'Motivo' }).expect(404);
    setPeriodoTestEstado(period.body.id, PeriodoEstado.ARCHIVADO);
    await authenticated('post', annulPath, 'admin-sub').send({ causa: 'OTRA', motivo: 'Motivo' }).expect(409);
  });

  it('reabre la postulación desde POSTULACION_CERRADA solo dentro del plazo y permite extender la fecha fin', async () => {
    addAdmin();
    const period = await createPeriod('REABRIR-1');
    const start = new Date(Date.now() - 2 * 60 * 60_000);
    const end = new Date(Date.now() - 60 * 60_000);
    const titulation = new Date(Date.now() + 24 * 60 * 60_000);
    await authenticated('patch', `/periodos/${period.body.id}`, 'admin-sub').send({
      fecha_inicio_postulacion: start.toISOString(), fecha_fin_postulacion: end.toISOString(), fecha_inicio_titulacion: titulation.toISOString(),
    }).expect(200);
    setPeriodoTestEstado(period.body.id, PeriodoEstado.POSTULACION_CERRADA);

    const expired = await authenticated('post', `/periodos/${period.body.id}/abrir-postulacion`, 'admin-sub').expect(409);
    expect(expired.body.message).toContain('Edita primero la fecha fin de postulación');
    await authenticated('patch', `/periodos/${period.body.id}`, 'admin-sub').send({ nombre: 'Otro nombre' }).expect(409);
    await authenticated('patch', `/periodos/${period.body.id}`, 'admin-sub').send({ fecha_inicio_titulacion: new Date(titulation.getTime() + 60_000).toISOString() }).expect(409);
    const newEnd = new Date(Date.now() + 60 * 60_000);
    await authenticated('patch', `/periodos/${period.body.id}`, 'admin-sub').send({
      codigo: 'REABRIR-1', nombre: 'Período de prueba', max_integrantes_default: 5,
      fecha_inicio_postulacion: start.toISOString(), fecha_fin_postulacion: newEnd.toISOString(), fecha_inicio_titulacion: titulation.toISOString(),
    }).expect(200);
    await authenticated('patch', `/periodos/${period.body.id}`, 'admin-sub').send({ fecha_fin_postulacion: new Date(titulation.getTime() + 60_000).toISOString() }).expect(400);

    const reopened = await authenticated('post', `/periodos/${period.body.id}/abrir-postulacion`, 'admin-sub').expect(200);
    expect(reopened.body.estado).toBe(PeriodoEstado.POSTULACION_ABIERTA);
    const audit = auditoriaTestRecords().find((entry) => entry.accion === 'REABRIR_POSTULACION');
    expect(audit?.valores_anteriores).toEqual({ estado: PeriodoEstado.POSTULACION_CERRADA });
    await authenticated('post', `/periodos/${period.body.id}/abrir-postulacion`, 'admin-sub').expect(409);
    setPeriodoTestEstado(period.body.id, PeriodoEstado.EN_CURSO);
    await authenticated('post', `/periodos/${period.body.id}/abrir-postulacion`, 'admin-sub').expect(409);
  });

  it('inicia la titulación desde POSTULACION_CERRADA en fecha y suspende a los condicionados pendientes', async () => {
    const anular = vi.spyOn(app.get(AsignacionTemaPersistenciaService), 'anularPorIncumplimiento');
    const cancelarPostulaciones = vi.spyOn(app.get(PostulacionPersistenciaService), 'cancelarPendientesPorNoAdmision');
    const retirarGrupo = vi.spyOn(app.get(GrupoIntegrantePersistenciaService), 'retirarPorNoAdmision');
    const admin = addAdmin();
    const period = await createPeriod('INICIO-TITULACION');
    const first = await createStudentProfile('student-sub', '0102030400', 'START-1');
    const second = await createStudentProfile('other-student-sub', '0102030418', 'START-2');
    const firstPending = await authenticated('post', `/periodos/${period.body.id}/habilitados`, 'admin-sub')
      .send({ estudiante_id: first.profile.body.id, condicion_ingreso: CondicionIngreso.CONDICIONADO, requisito_pendiente: 'Requisito A' })
      .expect(201);
    const secondPending = await authenticated('post', `/periodos/${period.body.id}/habilitados`, 'admin-sub')
      .send({ estudiante_id: second.profile.body.id, condicion_ingreso: CondicionIngreso.CONDICIONADO, requisito_pendiente: 'Requisito B' })
      .expect(201);

    const rows = habilitadosTestRecords();
    const firstRow = rows.find((row) => row.id === firstPending.body.id);
    const secondRow = rows.find((row) => row.id === secondPending.body.id);
    if (!firstRow || !secondRow) throw new Error('No se crearon los condicionados de prueba.');
    firstRow.estado = HabilitadoEstado.SUSPENDIDO;
    second.account.estado = UsuarioEstado.INACTIVO;

    admin.estado = UsuarioEstado.INACTIVO;
    await authenticated('post', `/periodos/${period.body.id}/iniciar-titulacion`, 'admin-sub').expect(403);
    admin.estado = UsuarioEstado.ACTIVO;

    await authenticated('post', `/periodos/${period.body.id}/iniciar-titulacion`, 'admin-sub').expect(409);
    setPeriodoTestEstado(period.body.id, PeriodoEstado.POSTULACION_CERRADA);
    setPeriodoTestInicioTitulacion(period.body.id, new Date(Date.now() + 60_000));
    await authenticated('post', `/periodos/${period.body.id}/iniciar-titulacion`, 'admin-sub').expect(409);
    await authenticated('post', `/periodos/${period.body.id}/iniciar-titulacion`, 'admin-sub')
      .send({ estado: PeriodoEstado.EN_CURSO }).expect(400);
    await authenticated('post', '/periodos/no-es-uuid/iniciar-titulacion', 'admin-sub').expect(400);
    addUsuarioTestRecord({ id_externo_sso: 'docente-sub', email: 'docente@universidad.edu', nombres: 'Docente', apellidos: 'Prueba', rol: UsuarioRol.DOCENTE });
    await authenticated('post', `/periodos/${period.body.id}/iniciar-titulacion`, 'docente-sub').expect(403);

    setPeriodoTestInicioTitulacion(period.body.id, new Date(Date.now() - 1_000));
    const started = await authenticated('post', `/periodos/${period.body.id}/iniciar-titulacion`, 'admin-sub').expect(200);
    expect(started.body.estado).toBe(PeriodoEstado.EN_CURSO);

    for (const row of [firstRow, secondRow]) {
      const stored = habilitadosTestRecords().find((candidate) => candidate.id === row.id);
      expect(stored).toMatchObject({
        estado: HabilitadoEstado.SUSPENDIDO,
        condicion_ingreso: CondicionIngreso.CONDICIONADO,
        situacion_ingreso: SituacionIngreso.NO_ADMITIDO,
        observacion_ingreso: 'Requisito no resuelto antes del inicio de titulación.',
        fecha_resolucion_ingreso: expect.any(Date),
      });
      expect(stored?.requisito_pendiente).toBe(row.id === firstRow.id ? 'Requisito A' : 'Requisito B');
      expect(stored?.resuelto_por?.id).toBe(admin.id);
    }
    const suspensions = auditoriaTestRecords().filter((entry) => entry.accion === 'SUSPENDER_HABILITACION_INICIO');
    expect(suspensions.map((entry) => entry.entidad_id).sort()).toEqual([firstRow.id, secondRow.id].sort());
    expect(suspensions.find((entry) => entry.entidad_id === secondRow.id)).toMatchObject({
      valores_anteriores: { estado: HabilitadoEstado.HABILITADO, situacion_ingreso: SituacionIngreso.PENDIENTE },
      valores_nuevos: { estado: HabilitadoEstado.SUSPENDIDO, situacion_ingreso: SituacionIngreso.NO_ADMITIDO },
    });
    const startAudit = auditoriaTestRecords().find((entry) => entry.accion === 'INICIAR_TITULACION');
    expect(startAudit?.valores_nuevos).toMatchObject({ estado: PeriodoEstado.EN_CURSO, condicionados_suspendidos: 2 });
    // Mismos efectos que la NO_ADMISIÓN manual: anulación de la asignación vigente y aviso al estudiante.
    expect(anular).toHaveBeenCalledTimes(2);
    for (const student of [first, second]) {
      expect(anular).toHaveBeenCalledWith(
        expect.anything(), period.body.id, student.profile.body.id, expect.objectContaining({ id: admin.id }),
        'Requisito no resuelto antes del inicio de titulación.', expect.any(String),
      );
    }
    // Cada suspendido pierde además sus postulaciones pendientes y su pertenencia al grupo activo.
    for (const effect of [cancelarPostulaciones, retirarGrupo]) {
      expect(effect).toHaveBeenCalledTimes(2);
      for (const student of [first, second]) {
        expect(effect).toHaveBeenCalledWith(
          expect.anything(), period.body.id, student.profile.body.id, expect.objectContaining({ id: admin.id }),
          'Requisito no resuelto antes del inicio de titulación.', expect.any(String),
        );
      }
    }
    expect(cancelarPostulaciones.mock.invocationCallOrder.every((order, index) =>
      order > anular.mock.invocationCallOrder[index]! && order < retirarGrupo.mock.invocationCallOrder[index]!)).toBe(true);
    expect(avisosIngreso).toEqual(expect.arrayContaining([
      { id: firstRow.id, actorId: admin.id, aviso: 'SUSPENSION_INICIO' },
      { id: secondRow.id, actorId: admin.id, aviso: 'SUSPENSION_INICIO' },
    ]));
    expect(avisosIngreso.filter((entry) => entry.aviso === 'SUSPENSION_INICIO')).toHaveLength(2);
    await authenticated('post', `/periodos/${period.body.id}/iniciar-titulacion`, 'admin-sub').expect(409);
  });

  it('resuelve condicionados en BORRADOR, POSTULACION_ABIERTA y POSTULACION_CERRADA, pero no en EN_CURSO ni ARCHIVADO', async () => {
    addAdmin();
    const period = await createPeriod('RESOLVER-ESTADOS');
    setPeriodoTestInicioTitulacion(period.body.id, new Date(Date.now() + 60 * 60_000));
    const students = [
      await createStudentProfile('student-sub', '0102030400', 'RES-1'),
      await createStudentProfile('other-student-sub', '0102030418', 'RES-2'),
      await createStudentProfile('bootstrap-sub', '0102030426', 'RES-3'),
      await createStudentProfile('inactive-sub', '0102030434', 'RES-4'),
    ];
    const pending = [];
    for (const student of students) {
      pending.push(await authenticated('post', `/periodos/${period.body.id}/habilitados`, 'admin-sub')
        .send({ estudiante_id: student.profile.body.id, condicion_ingreso: CondicionIngreso.CONDICIONADO, requisito_pendiente: 'Requisito' })
        .expect(201));
    }
    const resolver = (id: string) => authenticated('post', `/periodos/${period.body.id}/habilitados/${id}/resolver-ingreso`, 'admin-sub');

    setPeriodoTestEstado(period.body.id, PeriodoEstado.POSTULACION_ABIERTA);
    await resolver(pending[0].body.id).send({ situacion_ingreso: SituacionIngreso.ADMITIDO }).expect(200);
    setPeriodoTestEstado(period.body.id, PeriodoEstado.POSTULACION_CERRADA);
    await resolver(pending[1].body.id).send({ situacion_ingreso: SituacionIngreso.ADMITIDO }).expect(200);

    setPeriodoTestEstado(period.body.id, PeriodoEstado.EN_CURSO);
    const enCurso = await resolver(pending[2].body.id).send({ situacion_ingreso: SituacionIngreso.ADMITIDO }).expect(409);
    expect(enCurso.body.message).toContain('EN_CURSO');
    setPeriodoTestEstado(period.body.id, PeriodoEstado.ARCHIVADO);
    const archivado = await resolver(pending[3].body.id)
      .send({ situacion_ingreso: SituacionIngreso.NO_ADMITIDO, observacion_ingreso: 'Fuera de plazo' }).expect(409);
    expect(archivado.body.message).toContain('ARCHIVADO');
    expect(habilitadosTestRecords().filter((row) => row.situacion_ingreso === SituacionIngreso.PENDIENTE)).toHaveLength(2);

    setPeriodoTestEstado(period.body.id, PeriodoEstado.POSTULACION_CERRADA);
    await authenticated('post', `/periodos/${period.body.id}/habilitados`, 'admin-sub')
      .send({ estudiante_id: students[0].profile.body.id, condicion_ingreso: CondicionIngreso.REGULAR }).expect(409);
  });

  it('permite iniciar cuando todos los condicionados fueron admitidos antes de la fecha', async () => {
    addAdmin();
    const period = await createPeriod('INICIO-ADMITIDOS');
    const student = await createStudentProfile('student-sub', '0102030400', 'START-3');
    const start = new Date(Date.now() + 60_000);
    setPeriodoTestInicioTitulacion(period.body.id, start);
    const pending = await authenticated('post', `/periodos/${period.body.id}/habilitados`, 'admin-sub')
      .send({ estudiante_id: student.profile.body.id, condicion_ingreso: CondicionIngreso.CONDICIONADO, requisito_pendiente: 'Validar matrícula' })
      .expect(201);
    setPeriodoTestEstado(period.body.id, PeriodoEstado.POSTULACION_CERRADA);
    await authenticated('post', `/periodos/${period.body.id}/habilitados/${pending.body.id}/resolver-ingreso`, 'admin-sub')
      .send({ situacion_ingreso: SituacionIngreso.ADMITIDO }).expect(200);
    setPeriodoTestInicioTitulacion(period.body.id, new Date(Date.now() - 1_000));
    await authenticated('post', `/periodos/${period.body.id}/iniciar-titulacion`, 'admin-sub')
      .expect(200).then((response) => expect(response.body.estado).toBe(PeriodoEstado.EN_CURSO));
  });
});
