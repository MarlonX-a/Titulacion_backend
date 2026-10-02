import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { decodeJwt } from 'jose';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import type { AppEnvironment } from '../src/config/environment.js';
import { configureApplication } from '../src/config/setup-app.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { UsuarioEstado } from '../src/usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../src/usuarios/enums/usuario-rol.enum.js';
import {
  addUsuarioTestRecord,
  clearUsuarioTestRecords,
  DatabaseTestingModule,
} from './database-testing.module.js';

const password = 'local-test-password-long-enough';
const demoUsers = [
  {
    email: 'admin@example.test',
    subject: 'local-demo-admin',
    role: UsuarioRol.ADMIN,
  },
  {
    email: 'docente@example.test',
    subject: 'local-demo-docente',
    role: UsuarioRol.DOCENTE,
  },
  {
    email: 'estudiante@example.test',
    subject: 'local-demo-estudiante',
    role: UsuarioRol.ESTUDIANTE,
  },
] as const;

describe('Inicio de sesión local de pruebas (e2e)', () => {
  let app: INestApplication<App>;
  let demoRecords: ReturnType<typeof addUsuarioTestRecord>[];

  async function createLocalApp(): Promise<INestApplication<App>> {
    const config = new ConfigService<AppEnvironment, true>({
      NODE_ENV: 'test',
      AUTH_MODE: 'local',
      PORT: 3000,
      SWAGGER_ENABLED: true,
      DB_HOST: '127.0.0.1',
      DB_PORT: 5432,
      DB_SCHEMA: 'local_demo',
      DB_USERNAME: 'test_user',
      DB_PASSWORD: 'test_password',
      DB_NAME: 'test_database',
      LOCAL_AUTH_PASSWORD: password,
    });
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideModule(DatabaseModule)
      .useModule(DatabaseTestingModule)
      .overrideProvider(ConfigService)
      .useValue(config)
      .compile();

    const testApp =
      moduleFixture.createNestApplication<INestApplication<App>>();
    configureApplication(testApp);
    await testApp.init();
    return testApp;
  }

  function login(email: string, loginPassword = password) {
    return request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ email, password: loginPassword });
  }

  beforeAll(async () => {
    clearUsuarioTestRecords();
    demoRecords = demoUsers.map((user) =>
      addUsuarioTestRecord({
        email: user.email,
        id_externo_sso: user.subject,
        nombres: user.role,
        apellidos: 'Local',
        rol: user.role,
      }),
    );
    app = await createLocalApp();
  });

  afterAll(async () => {
    await app?.close();
    clearUsuarioTestRecords();
  });

  it('emite un token de 15 minutos sin rol y aplica no-store', async () => {
    const response = await login(' ADMIN@EXAMPLE.TEST ')
      .expect(200)
      .expect('Cache-Control', 'no-store');

    expect(response.body).toMatchObject({
      token_type: 'Bearer',
      expires_in: 900,
      access_token: expect.any(String),
    });
    expect(decodeJwt(response.body.access_token)).not.toHaveProperty('rol');
    expect(decodeJwt(response.body.access_token)).not.toHaveProperty('role');
  });

  it('permite el perfil propio a las tres cuentas y reserva el listado a ADMIN', async () => {
    for (const user of demoUsers) {
      const tokenResponse = await login(user.email).expect(200);
      const token = tokenResponse.body.access_token as string;
      const identity = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(identity.body).toMatchObject({
        subject: user.subject,
        issuer: 'http://127.0.0.1:3000/auth/local',
      });
      const profile = await request(app.getHttpServer())
        .get('/usuarios/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(profile.body.email).toBe(user.email);

      const users = request(app.getHttpServer())
        .get('/usuarios')
        .set('Authorization', `Bearer ${token}`);
      if (user.role === UsuarioRol.ADMIN) {
        await users.expect(200);
      } else {
        await users.expect(403);
      }
    }
  });

  it('rechaza contraseña o usuario desconocido sin revelar credenciales', async () => {
    await login('admin@example.test', 'incorrecta-de-prueba').expect(401);
    await login('nadie@example.test').expect(401);
    const response = await login('admin@example.test', 'incorrecta-de-prueba');
    expect(JSON.stringify(response.body)).not.toContain(password);
  });

  it('rechaza una cuenta local inactiva', async () => {
    demoRecords[1].estado = UsuarioEstado.INACTIVO;
    try {
      await login('docente@example.test').expect(403);
    } finally {
      demoRecords[1].estado = UsuarioEstado.ACTIVO;
    }
  });

  it('rechaza propiedades adicionales y token alterado', async () => {
    await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({
        email: 'admin@example.test',
        password,
        rol: UsuarioRol.ADMIN,
      })
      .expect(400);

    const { body } = await login('admin@example.test').expect(200);
    const parts = (body.access_token as string).split('.');
    parts[1] = Buffer.from(JSON.stringify({ sub: 'local-demo-estudiante' }))
      .toString('base64url');
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${parts.join('.')}`)
      .expect(401);
  });

  it('invalida tokens cuando la aplicación reinicia y genera nuevas claves', async () => {
    const { body } = await login('admin@example.test').expect(200);
    const restartedApp = await createLocalApp();
    try {
      await request(restartedApp.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${body.access_token as string}`)
        .expect(401);
    } finally {
      await restartedApp.close();
    }
  });

  it('publica el endpoint local en Swagger únicamente en este modo', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    expect(body.paths['/auth/local/login'].post).toBeDefined();
    expect(body.paths['/auth/local/login'].post.security).toBeUndefined();
  });

  it('limita a diez los intentos fallidos por minuto desde la dirección cliente', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await login('admin@example.test', 'clave-incorrecta').expect(401);
    }
    await login('admin@example.test').expect(429);
  });
});
