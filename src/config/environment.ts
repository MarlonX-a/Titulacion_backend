export type NodeEnvironment = 'development' | 'test' | 'production';

export interface AppEnvironment {
  NODE_ENV: NodeEnvironment;
  PORT: number;
  SWAGGER_ENABLED: boolean;
  DB_HOST: string;
  DB_PORT: number;
  DB_SCHEMA: string;
  DB_USERNAME: string;
  DB_PASSWORD: string;
  DB_NAME: string;
  JWT_PRIVATE_KEY_PATH?: string;
  JWT_PUBLIC_KEY_PATH?: string;
  AUTH_ISSUER: string;
  AUTH_ORIGINS: string[];
  REDIS_HOST?: string;
  REDIS_PORT: number;
  SMTP_HOST?: string;
  SMTP_PORT: number;
  SMTP_USERNAME?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM?: string;
  S3_ENDPOINT?: string;
  S3_REGION: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY?: string;
  S3_SECRET_KEY?: string;
  OUTBOX_ENCRYPTION_KEY_PATH?: string;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Configuración inválida: ${name} es obligatorio.`);
  }
  return value.trim();
}

function requiredSecret(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Configuración inválida: ${name} es obligatorio y no puede estar vacío.`);
  }
  return value;
}

function port(value: unknown, name: string, fallback: string): number {
  const raw = value ?? fallback;
  const validShape = typeof raw === 'number' ? Number.isInteger(raw) : typeof raw === 'string' && /^\d+$/.test(raw);
  const parsed = Number(raw);
  if (!validShape || !Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Configuración inválida: ${name} debe ser un entero entre 1 y 65535.`);
  }
  return parsed;
}

function httpsOrLoopbackUrl(value: unknown, name: string, fallback: string, production: boolean): string {
  const raw = requiredString(value ?? fallback, name);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Configuración inválida: ${name} debe ser URL válida.`);
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(loopback && !production && url.protocol === 'http:')) {
    throw new Error(`Configuración inválida: ${name} requiere HTTPS salvo en localhost.`);
  }
  return url.origin;
}

export function validateEnvironment(
  environment: Record<string, unknown>,
): AppEnvironment {
  const nodeEnv = environment.NODE_ENV ?? 'development';
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    throw new Error('Configuración inválida: NODE_ENV no es válido.');
  }
  const portValue = port(environment.PORT, 'PORT', '3000');
  const schema = environment.DB_SCHEMA ?? 'titulacion_dev';
  if (typeof schema !== 'string' || !/^[a-z][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error('Configuración inválida: DB_SCHEMA no es válido.');
  }
  const swagger = environment.SWAGGER_ENABLED;
  if (swagger !== undefined && swagger !== 'true' && swagger !== 'false') {
    throw new Error('Configuración inválida: SWAGGER_ENABLED debe ser true o false.');
  }
  const privateKeyPath = environment.JWT_PRIVATE_KEY_PATH;
  const publicKeyPath = environment.JWT_PUBLIC_KEY_PATH;
  if ((privateKeyPath === undefined) !== (publicKeyPath === undefined)) {
    throw new Error('Configuración inválida: configure ambas rutas JWT.');
  }
  if (nodeEnv === 'production' && (!privateKeyPath || !publicKeyPath)) {
    throw new Error('Configuración inválida: las claves JWT son obligatorias en production.');
  }
  const redisPort = port(environment.REDIS_PORT, 'REDIS_PORT', '6379');
  const smtpPort = port(environment.SMTP_PORT, 'SMTP_PORT', '1025');
  if (nodeEnv === 'production' && environment.AUTH_ISSUER === undefined) throw new Error('Configuración inválida: AUTH_ISSUER es obligatorio en production.');
  const originsRaw = typeof environment.AUTH_ORIGINS === 'string' ? environment.AUTH_ORIGINS : '';
  const origins = originsRaw.split(',').map((item) => item.trim()).filter(Boolean);
  httpsOrLoopbackUrl(environment.AUTH_ISSUER, 'AUTH_ISSUER', `http://127.0.0.1:${portValue}`, nodeEnv === 'production');
  for (const origin of origins) httpsOrLoopbackUrl(origin, 'AUTH_ORIGINS', origin, nodeEnv === 'production');
  const outboxKeyPath = environment.OUTBOX_ENCRYPTION_KEY_PATH;
  if ((environment.SMTP_USERNAME === undefined) !== (environment.SMTP_PASSWORD === undefined)) throw new Error('Configuración inválida: SMTP_USERNAME y SMTP_PASSWORD deben configurarse juntos.');
  if ((environment.S3_ACCESS_KEY === undefined) !== (environment.S3_SECRET_KEY === undefined)) throw new Error('Configuración inválida: S3_ACCESS_KEY y S3_SECRET_KEY deben configurarse juntos.');
  if (nodeEnv === 'production' && (!environment.REDIS_HOST || !environment.SMTP_HOST || !environment.SMTP_FROM || !environment.S3_BUCKET || !outboxKeyPath || origins.length === 0)) {
    throw new Error('Configuración inválida: Redis, SMTP, S3 y cifrado son obligatorios en production.');
  }
  const issuerConfigured = requiredString(environment.AUTH_ISSUER ?? `http://127.0.0.1:${portValue}`, 'AUTH_ISSUER');
  const issuerUrl = new URL(issuerConfigured);
  return {
    NODE_ENV: nodeEnv,
    PORT: portValue,
    SWAGGER_ENABLED: swagger === undefined ? nodeEnv !== 'production' : swagger === 'true',
    DB_HOST: requiredString(environment.DB_HOST ?? 'localhost', 'DB_HOST'),
    DB_PORT: port(environment.DB_PORT, 'DB_PORT', '5432'),
    DB_SCHEMA: schema,
    DB_USERNAME: requiredString(environment.DB_USERNAME, 'DB_USERNAME'),
    DB_PASSWORD: requiredSecret(environment.DB_PASSWORD, 'DB_PASSWORD'),
    DB_NAME: requiredString(environment.DB_NAME, 'DB_NAME'),
    ...(typeof privateKeyPath === 'string' ? { JWT_PRIVATE_KEY_PATH: requiredString(privateKeyPath, 'JWT_PRIVATE_KEY_PATH') } : {}),
    ...(typeof publicKeyPath === 'string' ? { JWT_PUBLIC_KEY_PATH: requiredString(publicKeyPath, 'JWT_PUBLIC_KEY_PATH') } : {}),
    AUTH_ISSUER: issuerUrl.href.replace(/\/$/, ''),
    AUTH_ORIGINS: origins,
    ...(typeof environment.REDIS_HOST === 'string' ? { REDIS_HOST: requiredString(environment.REDIS_HOST, 'REDIS_HOST') } : {}),
    REDIS_PORT: redisPort,
    ...(typeof environment.SMTP_HOST === 'string' ? { SMTP_HOST: requiredString(environment.SMTP_HOST, 'SMTP_HOST') } : {}),
    SMTP_PORT: smtpPort,
    ...(typeof environment.SMTP_USERNAME === 'string' ? { SMTP_USERNAME: environment.SMTP_USERNAME } : {}),
    ...(typeof environment.SMTP_PASSWORD === 'string' ? { SMTP_PASSWORD: environment.SMTP_PASSWORD } : {}),
    ...(typeof environment.SMTP_FROM === 'string' ? { SMTP_FROM: requiredString(environment.SMTP_FROM, 'SMTP_FROM') } : {}),
    ...(typeof environment.S3_ENDPOINT === 'string' ? { S3_ENDPOINT: httpsOrLoopbackUrl(environment.S3_ENDPOINT, 'S3_ENDPOINT', environment.S3_ENDPOINT, nodeEnv === 'production') } : {}),
    S3_REGION: typeof environment.S3_REGION === 'string' ? environment.S3_REGION : 'us-east-1',
    ...(typeof environment.S3_BUCKET === 'string' ? { S3_BUCKET: requiredString(environment.S3_BUCKET, 'S3_BUCKET') } : {}),
    ...(typeof environment.S3_ACCESS_KEY === 'string' ? { S3_ACCESS_KEY: environment.S3_ACCESS_KEY } : {}),
    ...(typeof environment.S3_SECRET_KEY === 'string' ? { S3_SECRET_KEY: environment.S3_SECRET_KEY } : {}),
    ...(typeof outboxKeyPath === 'string' ? { OUTBOX_ENCRYPTION_KEY_PATH: outboxKeyPath } : {}),
  };
}
