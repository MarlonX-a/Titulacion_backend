import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { INestApplication, Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { loadEnvironment } from '../../../src/config/load-environment.js';
import type { AppEnvironment } from '../../../src/config/environment.js';

/** Raíz del repositorio backend. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const ATTACK_ISSUER = 'http://127.0.0.1:3000';
export const ATTACK_ORIGIN = 'http://127.0.0.1:5173';

export interface AttackApp {
  app: INestApplication;
  /** URL base del servidor HTTP real (loopback, puerto efímero). */
  baseUrl: string;
  port: number;
  db: DataSource;
  schema: string;
  /** Nombre de esquema validado y entre comillas para interpolar en SQL. */
  s: string;
  privateKeyPem: string;
  publicKeyPem: string;
  /** Entorno con el que arrancó la aplicación (incluye credenciales: nunca imprimir). */
  env: Record<string, string>;
  redis: Redis;
  /** Borra los contadores del limitador para aislar cada prueba. */
  flushLimiter(): Promise<void>;
  close(): Promise<void>;
}

const SCHEMA_PATTERN = /^attack_[a-f0-9]{16}$/;

/** Entorno base del repositorio leído con el cargador de la propia aplicación. Nunca se imprime. */
export function baseEnvironment(): AppEnvironment {
  return loadEnvironment(join(REPO_ROOT, '.env'), {});
}

function databaseConnection(base: AppEnvironment, schema: string, migrations: string[] = []) {
  return new DataSource({
    type: 'postgres', host: base.DB_HOST, port: base.DB_PORT, username: base.DB_USERNAME,
    password: base.DB_PASSWORD, database: base.DB_NAME, schema, entities: [], migrations,
    applicationName: 'titulacion-attack', connectTimeoutMS: 5000,
  });
}

/** Crea un esquema temporal `attack_*`, ejecuta todas las migraciones compiladas y devuelve su nombre. */
export async function createTemporarySchema(base: AppEnvironment): Promise<string> {
  const schema = `attack_${randomBytes(8).toString('hex')}`;
  if (!SCHEMA_PATTERN.test(schema)) throw new Error('Esquema temporal inválido.');
  const admin = databaseConnection(base, 'public');
  await admin.initialize();
  try { await admin.query(`CREATE SCHEMA "${schema}"`); } finally { await admin.destroy(); }
  const migrator = databaseConnection(base, schema, [join(REPO_ROOT, 'dist/database/migrations/*.js').replaceAll('\\', '/')]);
  await migrator.initialize();
  try { await migrator.runMigrations({ transaction: 'all' }); } finally { await migrator.destroy(); }
  return schema;
}

export async function dropTemporarySchema(base: AppEnvironment, schema: string): Promise<void> {
  if (!SCHEMA_PATTERN.test(schema)) throw new Error('Se rechazó eliminar un esquema que no es temporal.');
  const admin = databaseConnection(base, 'public');
  await admin.initialize();
  try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await admin.destroy(); }
}

/** Claves desechables (JWT RS256 y llave del outbox) generadas en un directorio temporal. */
export function throwawayKeys(directory: string) {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const paths = { privateKey: join(directory, 'jwt-private.pem'), publicKey: join(directory, 'jwt-public.pem'), outboxKey: join(directory, 'outbox.key') };
  writeFileSync(paths.privateKey, pair.privateKey, { mode: 0o600 });
  writeFileSync(paths.publicKey, pair.publicKey, { mode: 0o644 });
  writeFileSync(paths.outboxKey, randomBytes(32), { mode: 0o600 });
  return { ...paths, privateKeyPem: pair.privateKey, publicKeyPem: pair.publicKey };
}

/** Variables de proceso del arranque de ataque: modo development real, sin SWAGGER_ENABLED explícito. */
export function attackEnvironment(base: AppEnvironment, schema: string, keys: ReturnType<typeof throwawayKeys>, extra: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'development',
    PORT: '3000',
    DB_HOST: base.DB_HOST, DB_PORT: String(base.DB_PORT), DB_USERNAME: base.DB_USERNAME,
    DB_PASSWORD: base.DB_PASSWORD, DB_NAME: base.DB_NAME, DB_SCHEMA: schema,
    JWT_PRIVATE_KEY_PATH: keys.privateKey, JWT_PUBLIC_KEY_PATH: keys.publicKey,
    OUTBOX_ENCRYPTION_KEY_PATH: keys.outboxKey,
    AUTH_ISSUER: ATTACK_ISSUER, AUTH_ORIGINS: ATTACK_ORIGIN,
    TRUST_PROXY: '1',
    REDIS_HOST: base.REDIS_HOST ?? '127.0.0.1', REDIS_PORT: String(base.REDIS_PORT),
    ...(base.REDIS_PASSWORD ? { REDIS_PASSWORD: base.REDIS_PASSWORD } : {}),
    ...(base.REDIS_TLS ? { REDIS_TLS: 'true' } : {}),
    SMTP_HOST: base.SMTP_HOST ?? '127.0.0.1', SMTP_PORT: String(base.SMTP_PORT),
    SMTP_FROM: 'Ataque <no-reply@localhost>',
    ...(base.S3_ENDPOINT ? { S3_ENDPOINT: base.S3_ENDPOINT } : {}),
    S3_REGION: base.S3_REGION,
    S3_BUCKET: 'titulacion-attack',
    ...(base.S3_ACCESS_KEY && base.S3_SECRET_KEY ? { S3_ACCESS_KEY: base.S3_ACCESS_KEY, S3_SECRET_KEY: base.S3_SECRET_KEY } : {}),
    ...extra,
  };
}

const MANAGED_KEYS = ['NODE_ENV', 'PORT', 'SWAGGER_ENABLED', 'DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD', 'DB_NAME', 'DB_SCHEMA',
  'JWT_PRIVATE_KEY_PATH', 'JWT_PUBLIC_KEY_PATH', 'OUTBOX_ENCRYPTION_KEY_PATH', 'AUTH_ISSUER', 'AUTH_ORIGINS', 'TRUST_PROXY',
  'REDIS_HOST', 'REDIS_PORT', 'REDIS_PASSWORD', 'REDIS_TLS', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM', 'SMTP_USERNAME', 'SMTP_PASSWORD',
  'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'IMPORT_TEMP_TTL_HOURS'];

/** Arranques realizados en este proceso; distingue cada evaluación de `app.module.js`. */
let arranques = 0;

/**
 * Importa un módulo compilado. Con `instanciaNueva`, la URL lleva una consulta única para que
 * Node evalúe de nuevo ese archivo: `ConfigModule.forRoot` valida `process.env` al evaluarse
 * `app.module.js`, y la caché de módulos ESM haría que un segundo arranque en el mismo proceso
 * (por ejemplo, el de Redis inalcanzable) reutilizara el esquema, las claves JWT y el Redis del
 * primero.
 */
async function importDist<T>(relativePath: string, instanciaNueva = false): Promise<T> {
  const file = join(REPO_ROOT, 'dist', relativePath);
  if (!existsSync(file)) throw new Error(`Falta ${relativePath} en dist/. Ejecuta npm run build antes de la suite de ataque.`);
  const url = pathToFileURL(file).href;
  return await import(instanciaNueva ? `${url}?arranque=${arranques}` : url) as T;
}

/**
 * Arranca la aplicación compilada igual que `src/main.ts` (trust proxy, x-powered-by,
 * configureApplication, CORS) sobre un esquema temporal migrado, Redis real y claves
 * desechables. ConfigModule no encuentra `.env` porque el proceso cambia de directorio.
 */
export async function bootAttackApp(extra: Record<string, string> = {}, options: { host?: string; sinRedis?: boolean } = {}): Promise<AttackApp> {
  const base = baseEnvironment();
  const tempDir = mkdtempSync(join(tmpdir(), 'titulacion-attack-'));
  const keys = throwawayKeys(tempDir);
  const schema = await createTemporarySchema(base);
  const env = attackEnvironment(base, schema, keys, extra);
  const previousEnv = Object.fromEntries(MANAGED_KEYS.map((key) => [key, process.env[key]]));
  const previousCwd = process.cwd();
  for (const key of MANAGED_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  process.chdir(tempDir);

  let app: NestExpressApplication | undefined;
  const redis = new Redis({ host: env.REDIS_HOST, port: Number(env.REDIS_PORT), ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}), ...(env.REDIS_TLS === 'true' ? { tls: {} } : {}), lazyConnect: true, maxRetriesPerRequest: 1 });
  const restore = async () => {
    process.chdir(previousCwd);
    for (const key of MANAGED_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    await redis.quit().catch(() => undefined);
    await dropTemporarySchema(base, schema).catch(() => undefined);
    rmSync(tempDir, { recursive: true, force: true });
  };
  try {
    arranques += 1;
    const { AppModule } = await importDist<{ AppModule: Type<unknown> }>('app.module.js', true);
    const { configureApplication } = await importDist<{ configureApplication: (app: INestApplication) => void }>('config/setup-app.js');
    app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error'] });
    app.enableShutdownHooks();
    const config = app.get(ConfigService<AppEnvironment, true>);
    app.set('trust proxy', config.get('TRUST_PROXY', { infer: true }));
    app.disable('x-powered-by');
    configureApplication(app);
    const origins = config.get('AUTH_ORIGINS', { infer: true });
    if (origins.length > 0) {
      app.enableCors({ origin: origins, credentials: true, allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'], methods: ['GET', 'POST', 'PATCH', 'OPTIONS'] });
    }
    await app.listen(0, options.host ?? '127.0.0.1');
    // `sinRedis`: la aplicación apunta a un Redis inalcanzable; el cliente auxiliar no se conecta.
    if (!options.sinRedis) await redis.connect();
  } catch (error: unknown) {
    await app?.close().catch(() => undefined);
    await restore();
    throw error;
  }
  const server = app.getHttpServer() as { address(): { port: number } };
  const port = server.address().port;
  const started = app;
  return {
    app: started, baseUrl: `http://127.0.0.1:${port}`, port, db: started.get(DataSource), schema, s: `"${schema}"`,
    privateKeyPem: keys.privateKeyPem, publicKeyPem: keys.publicKeyPem, env, redis,
    async flushLimiter() {
      if (options.sinRedis) return;
      for (const pattern of ['titulacion:auth-rate:*', 'titulacion:rate*']) {
        let cursor = '0';
        do {
          const [next, keysFound] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
          cursor = next;
          if (keysFound.length) await redis.del(...keysFound);
        } while (cursor !== '0');
      }
    },
    async close() {
      const cierre = started.close().catch(() => undefined);
      if (options.sinRedis) {
        // Con Redis inalcanzable, el cierre de las colas BullMQ espera una conexión que nunca llega
        // y `app.close()` no termina; se acota para que la suite continúe (el proceso de prueba se
        // descarta al acabar el archivo).
        let temporizador: NodeJS.Timeout | undefined;
        await Promise.race([cierre, new Promise<void>((resolve) => { temporizador = setTimeout(resolve, 10_000); })]);
        clearTimeout(temporizador);
      } else {
        await cierre;
      }
      await restore();
    },
  };
}

export const uuid = (): string => randomUUID();
