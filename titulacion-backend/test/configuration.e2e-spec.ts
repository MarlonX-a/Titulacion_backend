import { Body, Controller, Post, type INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Type } from 'class-transformer';
import { IsInt, IsString, Min, MinLength } from 'class-validator';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import {
  validateEnvironment,
  type AppEnvironment,
} from '../src/config/environment.js';
import { configureApplication } from '../src/config/setup-app.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { DatabaseTestingModule } from './database-testing.module.js';
import { Public } from '../src/auth/public.decorator.js';

class ValidationInputDto {
  @IsString({ message: 'nombre debe ser un texto.' })
  @MinLength(2, { message: 'nombre debe tener al menos 2 caracteres.' })
  nombre: string;

  @Type(() => Number)
  @IsInt({ message: 'cantidad debe ser un entero.' })
  @Min(1, { message: 'cantidad debe ser mayor o igual a 1.' })
  cantidad: number;
}

// Este controlador solo se registra en las pruebas, nunca en AppModule.
@Controller('test-validation')
@Public()
class ValidationController {
  @Post()
  validate(@Body() dto: ValidationInputDto) {
    return {
      nombre: dto.nombre,
      cantidad: dto.cantidad,
      transformed: dto instanceof ValidationInputDto,
    };
  }
}

async function createTestApplication(
  swaggerEnabled: boolean,
): Promise<INestApplication<App>> {
  const config = new ConfigService<AppEnvironment, true>({
    NODE_ENV: 'test',
    PORT: 3000,
    SWAGGER_ENABLED: swaggerEnabled,
  });
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [ValidationController],
  })
    .overrideModule(DatabaseModule)
    .useModule(DatabaseTestingModule)
    .overrideProvider(ConfigService)
    .useValue(config)
    .compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  configureApplication(app);
  await app.init();
  return app;
}

describe('Variables de entorno (e2e)', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', undefined);
    vi.stubEnv('AUTH_MODE', undefined);
    vi.stubEnv('PORT', undefined);
    vi.stubEnv('SWAGGER_ENABLED', undefined);
    vi.stubEnv('DB_HOST', undefined);
    vi.stubEnv('DB_PORT', undefined);
    vi.stubEnv('DB_SCHEMA', undefined);
    vi.stubEnv('DB_USERNAME', 'test_user');
    vi.stubEnv('DB_PASSWORD', 'test_password');
    vi.stubEnv('DB_NAME', 'test_database');
    vi.stubEnv('OIDC_ISSUER', undefined);
    vi.stubEnv('OIDC_AUDIENCE', undefined);
    vi.stubEnv('JWKS_URI', undefined);
    vi.stubEnv('LOCAL_AUTH_PASSWORD', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function readConfiguration(ignoreEnvFile = false) {
    const moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          envFilePath: '.env.example',
          ignoreEnvFile,
          validate: validateEnvironment,
        }),
      ],
    }).compile();

    try {
      const config = moduleFixture.get(ConfigService<AppEnvironment, true>);
      return {
        NODE_ENV: config.get('NODE_ENV', { infer: true }),
        AUTH_MODE: config.get('AUTH_MODE', { infer: true }),
        PORT: config.get('PORT', { infer: true }),
        SWAGGER_ENABLED: config.get('SWAGGER_ENABLED', { infer: true }),
        DB_HOST: config.get('DB_HOST', { infer: true }),
        DB_PORT: config.get('DB_PORT', { infer: true }),
        DB_SCHEMA: config.get('DB_SCHEMA', { infer: true }),
        DB_USERNAME: config.get('DB_USERNAME', { infer: true }),
        DB_PASSWORD: config.get('DB_PASSWORD', { infer: true }),
        DB_NAME: config.get('DB_NAME', { infer: true }),
        OIDC_ISSUER: config.get('OIDC_ISSUER', { infer: true }),
        OIDC_AUDIENCE: config.get('OIDC_AUDIENCE', { infer: true }),
        JWKS_URI: config.get('JWKS_URI', { infer: true }),
        LOCAL_AUTH_PASSWORD: config.get('LOCAL_AUTH_PASSWORD', { infer: true }),
      };
    } finally {
      await moduleFixture.close();
    }
  }

  it('lee el archivo de ejemplo y devuelve valores tipados', async () => {
    vi.stubEnv('DB_USERNAME', undefined);
    vi.stubEnv('DB_PASSWORD', undefined);
    vi.stubEnv('DB_NAME', undefined);
    expect(await readConfiguration()).toEqual({
        NODE_ENV: 'development',
      AUTH_MODE: 'institutional',
      PORT: 3000,
      SWAGGER_ENABLED: true,
      DB_HOST: 'localhost',
      DB_PORT: 5432,
      DB_SCHEMA: 'public',
      DB_USERNAME: 'postgres',
      DB_PASSWORD: 'CAMBIAR_PASSWORD',
      DB_NAME: 'titulacion_bd',
      OIDC_ISSUER: undefined,
      OIDC_AUDIENCE: undefined,
      JWKS_URI: undefined,
      LOCAL_AUTH_PASSWORD: undefined,
    });
  });

  it('da prioridad al entorno de ejecución sobre el archivo', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PORT', '4500');
    vi.stubEnv('SWAGGER_ENABLED', 'false');
    vi.stubEnv('DB_HOST', 'db.test');
    vi.stubEnv('DB_PORT', '5433');
    vi.stubEnv('OIDC_ISSUER', 'https://issuer.test');
    vi.stubEnv('OIDC_AUDIENCE', 'api-test');
    vi.stubEnv('JWKS_URI', 'https://issuer.test/keys');

    expect(await readConfiguration()).toEqual({
      NODE_ENV: 'production',
      AUTH_MODE: 'institutional',
      PORT: 4500,
      SWAGGER_ENABLED: false,
      DB_HOST: 'db.test',
      DB_PORT: 5433,
      DB_SCHEMA: 'public',
      DB_USERNAME: 'test_user',
      DB_PASSWORD: 'test_password',
      DB_NAME: 'test_database',
      OIDC_ISSUER: 'https://issuer.test',
      OIDC_AUDIENCE: 'api-test',
      JWKS_URI: 'https://issuer.test/keys',
      LOCAL_AUTH_PASSWORD: undefined,
    });
  });

  it('aplica valores predeterminados sin archivo de entorno', async () => {
    expect(await readConfiguration(true)).toEqual({
      NODE_ENV: 'development',
      AUTH_MODE: 'institutional',
      PORT: 3000,
      SWAGGER_ENABLED: true,
      DB_HOST: 'localhost',
      DB_PORT: 5432,
      DB_SCHEMA: 'public',
      DB_USERNAME: 'test_user',
      DB_PASSWORD: 'test_password',
      DB_NAME: 'test_database',
      OIDC_ISSUER: undefined,
      OIDC_AUDIENCE: undefined,
      JWKS_URI: undefined,
      LOCAL_AUTH_PASSWORD: undefined,
    });
  });

  it('permite elegir autenticación local desde el entorno sobre el archivo', async () => {
    vi.stubEnv('AUTH_MODE', 'local');
    vi.stubEnv('DB_SCHEMA', 'local_demo');
    vi.stubEnv('LOCAL_AUTH_PASSWORD', 'clave-local-de-pruebas-larga');

    expect(await readConfiguration()).toMatchObject({
      AUTH_MODE: 'local',
      DB_SCHEMA: 'local_demo',
      LOCAL_AUTH_PASSWORD: 'clave-local-de-pruebas-larga',
    });
  });

  it('deshabilita Swagger por defecto en producción', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('OIDC_ISSUER', 'https://issuer.test');
    vi.stubEnv('OIDC_AUDIENCE', 'api-test');
    vi.stubEnv('JWKS_URI', 'https://issuer.test/keys');

    expect(await readConfiguration(true)).toEqual({
      NODE_ENV: 'production',
      AUTH_MODE: 'institutional',
      PORT: 3000,
      SWAGGER_ENABLED: false,
      DB_HOST: 'localhost',
      DB_PORT: 5432,
      DB_SCHEMA: 'public',
      DB_USERNAME: 'test_user',
      DB_PASSWORD: 'test_password',
      DB_NAME: 'test_database',
      OIDC_ISSUER: 'https://issuer.test',
      OIDC_AUDIENCE: 'api-test',
      JWKS_URI: 'https://issuer.test/keys',
      LOCAL_AUTH_PASSWORD: undefined,
    });
  });

  it('detiene la carga del módulo ante una variable inválida', async () => {
    vi.stubEnv('PORT', 'valor-inválido');

    await expect(
      ConfigModule.forRoot({
        envFilePath: '.env.example',
        validate: validateEnvironment,
      }),
    ).rejects.toThrow(
      'Configuración inválida: PORT debe ser un entero entre 1 y 65535.',
    );
  });
});

describe('Configuración global (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApplication(true);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('acepta un DTO válido y transforma el body a una instancia', async () => {
    await request(app.getHttpServer())
      .post('/test-validation')
      .send({ nombre: 'Prueba', cantidad: '2' })
      .expect(201)
      .expect({ nombre: 'Prueba', cantidad: 2, transformed: true });
  });

  it.each([
    { nombre: 123, cantidad: 2 },
    { nombre: 'A', cantidad: 2 },
    { nombre: 'Prueba', cantidad: 0 },
    { nombre: 'Prueba', cantidad: 1.5 },
    { nombre: 'Prueba', cantidad: 'inválido' },
    {},
  ])('rechaza un DTO inválido con HTTP 400: %j', async (body) => {
    await request(app.getHttpServer())
      .post('/test-validation')
      .send(body)
      .expect(400);
  });

  it('rechaza propiedades adicionales con HTTP 400', async () => {
    await request(app.getHttpServer())
      .post('/test-validation')
      .send({ nombre: 'Prueba', cantidad: 2, adicional: 'no permitido' })
      .expect(400);
  });

  it('sirve la interfaz Swagger', async () => {
    await request(app.getHttpServer())
      .get('/docs')
      .expect(200)
      .expect('Content-Type', /html/)
      .expect(/swagger-ui/);
  });

  it('documenta el título, GET / y su respuesta en OpenAPI', async () => {
    await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200)
      .expect('Content-Type', /json/)
      .expect((response) => {
        expect(response.body.paths).not.toHaveProperty('/auth/local/login');
        expect(response.body).toMatchObject({
          info: {
            title: 'Sistema de Gestión del Proceso de Titulación',
            version: '0.0.1',
          },
          paths: {
            '/': {
              get: {
                responses: {
                  '200': {
                    content: {
                      'text/html': {
                        schema: { type: 'string', example: 'Hello World!' },
                      },
                    },
                  },
                },
              },
            },
            '/auth/me': {
              get: {
                security: [{ bearer: [] }],
              },
            },
          },
          components: {
            securitySchemes: {
              bearer: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
              },
            },
          },
        });
      });
  });
});

describe('Swagger deshabilitado (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApplication(false);
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each(['/docs', '/docs-json'])(
    'no publica %s cuando SWAGGER_ENABLED=false',
    async (path) => {
      await request(app.getHttpServer()).get(path).expect(404);
    },
  );

  it('conserva GET / aunque Swagger esté deshabilitado', async () => {
    await request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
