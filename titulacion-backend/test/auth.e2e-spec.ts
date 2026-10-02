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
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/config/setup-app.js';
import type { AppEnvironment } from '../src/config/environment.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { DatabaseTestingModule } from './database-testing.module.js';

const issuerPath = '/issuer';
const audience = 'titulacion-api-test';

interface TestKey {
  privateKey: CryptoKey;
  publicJwk: JWK;
}

interface TokenOptions {
  key?: TestKey;
  useBadSignature?: boolean;
  kid?: string;
  algorithm?: 'RS256' | 'HS256';
  subject?: string;
  omitSubject?: boolean;
  issuer?: string;
  omitIssuer?: boolean;
  omitExpiration?: boolean;
  audience?: string;
  expiration?: number | '2m' | undefined;
  notBefore?: number;
}

describe('Autenticación institucional (e2e)', () => {
  let app!: INestApplication<App>;
  let server: Server;
  let issuer: string;
  let jwksUri: string;
  let activeKeys: JWK[] = [];
  let fetchCount = 0;
  let signingKey: TestKey;
  let rotatedKey: TestKey;
  let badSignatureKey: TestKey;

  async function makeKey(kid: string): Promise<TestKey> {
    const pair = await generateKeyPair('RS256');
    const publicJwk = await exportJWK(pair.publicKey);
    publicJwk.kid = kid;
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';
    return { privateKey: pair.privateKey, publicJwk };
  }

  async function createTestApp(keysUri: string) {
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
      OIDC_AUDIENCE: audience,
      JWKS_URI: keysUri,
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

  async function createToken(options: TokenOptions = {}): Promise<string> {
    const key =
      options.key ?? (options.useBadSignature ? badSignatureKey : signingKey);
    const algorithm = options.algorithm ?? 'RS256';
    const payload: Record<string, string> = {};
    if (!options.omitSubject)
      payload.sub = options.subject ?? 'institutional-user-42';

    const builder = new SignJWT(payload).setProtectedHeader({
      alg: algorithm,
      ...(algorithm === 'RS256' ? { kid: options.kid ?? 'key-1' } : {}),
    });

    if (!options.omitIssuer) builder.setIssuer(options.issuer ?? issuer);
    builder.setAudience(options.audience ?? audience);
    if (!options.omitExpiration) {
      builder.setExpirationTime(options.expiration ?? '2m');
    }
    if (options.notBefore !== undefined)
      builder.setNotBefore(options.notBefore);

    return builder.sign(
      algorithm === 'RS256'
        ? key.privateKey
        : new TextEncoder().encode('test-secret'),
    );
  }

  beforeAll(async () => {
    signingKey = await makeKey('key-1');
    rotatedKey = await makeKey('key-2');
    badSignatureKey = await makeKey('key-1');
    activeKeys = [signingKey.publicJwk];

    server = createServer((requestMessage, response) => {
      if (requestMessage.url === '/jwks-down') {
        response.writeHead(503).end();
        return;
      }

      fetchCount += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ keys: activeKeys }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    issuer = `http://127.0.0.1:${address.port}${issuerPath}`;
    jwksUri = `http://127.0.0.1:${address.port}/jwks`;
    app = await createTestApp(jwksUri);
  });

  afterAll(async () => {
    await app?.close();
    server?.close();
    await once(server, 'close');
  });

  it('mantiene GET / público y exige Bearer en las rutas protegidas', async () => {
    await request(app.getHttpServer()).get('/').expect(200, 'Hello World!');
    await request(app.getHttpServer())
      .post('/auth/local/login')
      .send({ email: 'admin@example.test', password: 'clave-local-de-prueba' })
      .expect(404);
    await request(app.getHttpServer()).get('/auth/me').expect(401);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Basic abc')
      .expect(401);
  });

  it('verifica el token y devuelve únicamente subject e issuer', async () => {
    const token = await createToken();
    const response = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual({
      subject: 'institutional-user-42',
      issuer,
    });
    expect(response.body).not.toHaveProperty('roles');
  });

  it.each([
    { description: 'firma incorrecta', options: { useBadSignature: true } },
    { description: 'clave desconocida', options: { kid: 'unknown-key' } },
    {
      description: 'emisor incorrecto',
      options: { issuer: 'https://otro.example' },
    },
    { description: 'audiencia incorrecta', options: { audience: 'otra-api' } },
    { description: 'subject vacío', options: { subject: '   ' } },
    { description: 'subject ausente', options: { omitSubject: true } },
    { description: 'emisor ausente', options: { omitIssuer: true } },
    { description: 'expiración ausente', options: { omitExpiration: true } },
    {
      description: 'algoritmo no permitido',
      options: { algorithm: 'HS256' as const },
    },
    { description: 'token expirado', options: { expiration: 0 } },
    {
      description: 'token aún no válido',
      options: { notBefore: Math.floor(Date.now() / 1000) + 120 },
    },
  ])('rechaza $description con HTTP 401', async ({ options }) => {
    const token = await createToken(options);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('reutiliza claves almacenadas y actualiza el JWKS al aparecer un kid nuevo', async () => {
    const initialFetchCount = fetchCount;
    const firstToken = await createToken();
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${firstToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${firstToken}`)
      .expect(200);
    expect(fetchCount).toBe(initialFetchCount);

    activeKeys = [rotatedKey.publicJwk];
    const rotatedToken = await createToken({ key: rotatedKey, kid: 'key-2' });
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${rotatedToken}`)
      .expect(401);

    const advancedTime = Date.now() + 31_000;
    const now = vi.spyOn(Date, 'now').mockReturnValue(advancedTime);
    try {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${rotatedToken}`)
        .expect(200);
    } finally {
      now.mockRestore();
    }
    expect(fetchCount).toBe(initialFetchCount + 1);
  });

  it('responde 503 si el proveedor no entrega un JWKS disponible', async () => {
    const unavailableApp = await createTestApp(
      `${issuer.replace(issuerPath, '')}/jwks-down`,
    );
    try {
      const token = await createToken();
      await request(unavailableApp.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(503);
    } finally {
      await unavailableApp.close();
    }
  });
});

describe('Autenticación no configurada (e2e)', () => {
  it('rechaza rutas protegidas con 503 pero conserva las rutas públicas', async () => {
    const config = new ConfigService<AppEnvironment, true>({
      NODE_ENV: 'test',
      PORT: 3000,
      SWAGGER_ENABLED: false,
      DB_HOST: '127.0.0.1',
      DB_PORT: 1,
      DB_USERNAME: 'test_user',
      DB_PASSWORD: 'test_password',
      DB_NAME: 'test_database',
    });
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideModule(DatabaseModule)
      .useModule(DatabaseTestingModule)
      .overrideProvider(ConfigService)
      .useValue(config)
      .compile();
    const app = moduleFixture.createNestApplication<INestApplication<App>>();
    configureApplication(app);
    await app.init();

    try {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer syntactically-valid')
        .expect(503);
      await request(app.getHttpServer()).get('/').expect(200);
    } finally {
      await app.close();
    }
  });
});
