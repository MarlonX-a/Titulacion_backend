/** Valores admitidos de NODE_ENV. `test` solo lo usan las pruebas; `main.ts` no arranca con él. */
const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

function isNodeEnvironment(value: unknown): value is NodeEnvironment {
  return NODE_ENVIRONMENTS.some((item) => item === value);
}

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
  /** Contraseña de Redis (AUTH). Obligatoria en production. */
  REDIS_PASSWORD?: string;
  /** Conexión TLS con Redis. Predeterminado: false. */
  REDIS_TLS: boolean;
  /** Conexión TLS con PostgreSQL. Predeterminado: true en production, false en otros entornos. */
  DB_SSL: boolean;
  /** Verifica el certificado de PostgreSQL cuando DB_SSL está activo. Predeterminado: true. */
  DB_SSL_REJECT_UNAUTHORIZED: boolean;
  SMTP_HOST?: string;
  SMTP_PORT: number;
  SMTP_USERNAME?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM?: string;
  /** Exige STARTTLS con el servidor SMTP. Predeterminado: true en production, false en otros entornos. */
  SMTP_REQUIRE_TLS: boolean;
  S3_ENDPOINT?: string;
  S3_REGION: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY?: string;
  S3_SECRET_KEY?: string;
  OUTBOX_ENCRYPTION_KEY_PATH?: string;
  TRUST_PROXY: TrustProxySetting;
  /** Horas de vigencia de la clave temporal (la cédula) de los estudiantes creados por importación. Entero 1–168; predeterminado 24. */
  IMPORT_TEMP_TTL_HOURS: number;
  /**
   * Tareas periódicas en segundo plano: scheduler de transiciones de período y barridos de
   * exportaciones y limpieza de archivos. Predeterminado: true; las pruebas lo desactivan.
   */
  BACKGROUND_TASKS_ENABLED: boolean;
  /**
   * No leer `.env` al cargar la configuración (solo variables del proceso). Predeterminado: false;
   * las pruebas lo activan para no depender del `.env` local.
   */
  IGNORE_ENV_FILE: boolean;
}

/** Valor aceptado por Express para `trust proxy`: booleano, número de saltos o lista de subredes/presets. */
export type TrustProxySetting = boolean | number | string;

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

/** Entero dentro de [min, max], escrito como número o cadena de dígitos; sin valor usa `fallback`. */
function boundedInteger(value: unknown, name: string, fallback: number, min: number, max: number): number {
  const raw = typeof value === 'string' && value.trim().length === 0 ? undefined : value ?? undefined;
  if (raw === undefined) return fallback;
  const validShape = typeof raw === 'number' ? Number.isInteger(raw) : typeof raw === 'string' && /^\d+$/.test(raw.trim());
  const parsed = Number(typeof raw === 'string' ? raw.trim() : raw);
  if (!validShape || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Configuración inválida: ${name} debe ser un entero entre ${min} y ${max}.`);
  }
  return parsed;
}

/** Interpreta una opción booleana escrita como `true` o `false`; sin valor usa `fallback`. */
function booleanFlag(value: unknown, name: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Configuración inválida: ${name} debe ser true o false.`);
}

/**
 * Impide usar `NODE_ENV=test` fuera de las pruebas automatizadas: ese modo no existe en
 * tiempo de ejecución y el proceso debe terminar antes de abrir conexiones o puertos.
 */
export function assertRuntimeEnvironment(nodeEnv: unknown): void {
  if (nodeEnv === 'test') {
    throw new Error('Configuración inválida: NODE_ENV=test solo se admite en las pruebas automatizadas; la aplicación no arranca en ese modo.');
  }
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

/**
 * Interpreta TRUST_PROXY. Sin valor se mantiene `false`: Express ignora
 * X-Forwarded-For y `request.ip` es la dirección de la conexión directa.
 */
export function parseTrustProxy(value: unknown): TrustProxySetting {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'string') throw new Error('Configuración inválida: TRUST_PROXY no es válido.');
  const raw = value.trim();
  if (raw.length === 0 || raw === 'false') return false;
  if (raw === 'true') return true;
  if (/^\d+$/.test(raw)) return Number(raw);
  const entries = raw.split(',').map((item) => item.trim());
  if (entries.some((item) => !/^[A-Za-z0-9.:/]+$/.test(item))) {
    throw new Error('Configuración inválida: TRUST_PROXY debe ser true, false, un número de saltos o una lista de subredes.');
  }
  return entries.join(', ');
}

export function validateEnvironment(
  environment: Record<string, unknown>,
): AppEnvironment {
  const nodeEnv = environment.NODE_ENV ?? 'development';
  if (!isNodeEnvironment(nodeEnv)) {
    throw new Error('Configuración inválida: NODE_ENV no es válido.');
  }
  const portValue = port(environment.PORT, 'PORT', '3000');
  const schema = environment.DB_SCHEMA ?? 'titulacion_dev';
  if (typeof schema !== 'string' || !/^[a-z][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error('Configuración inválida: DB_SCHEMA no es válido.');
  }
  const production = nodeEnv === 'production';
  // Swagger expone el contrato completo de la API: solo se monta si se pide explícitamente.
  const swagger = booleanFlag(environment.SWAGGER_ENABLED, 'SWAGGER_ENABLED', false);
  const redisTls = booleanFlag(environment.REDIS_TLS, 'REDIS_TLS', false);
  const dbSsl = booleanFlag(environment.DB_SSL, 'DB_SSL', production);
  const dbSslRejectUnauthorized = booleanFlag(environment.DB_SSL_REJECT_UNAUTHORIZED, 'DB_SSL_REJECT_UNAUTHORIZED', true);
  const smtpRequireTls = booleanFlag(environment.SMTP_REQUIRE_TLS, 'SMTP_REQUIRE_TLS', production);
  const redisPassword = environment.REDIS_PASSWORD;
  if (redisPassword !== undefined && typeof redisPassword !== 'string') throw new Error('Configuración inválida: REDIS_PASSWORD no es válido.');
  const trustProxy = parseTrustProxy(environment.TRUST_PROXY);
  const importTempTtlHours = boundedInteger(environment.IMPORT_TEMP_TTL_HOURS, 'IMPORT_TEMP_TTL_HOURS', 24, 1, 168);
  const backgroundTasks = booleanFlag(environment.BACKGROUND_TASKS_ENABLED, 'BACKGROUND_TASKS_ENABLED', true);
  // Sin tareas en segundo plano no hay transiciones automáticas de período ni limpieza de
  // exportaciones (archivos con datos personales) ni de archivos huérfanos: solo para pruebas.
  if (production && !backgroundTasks) {
    throw new Error('Configuración inválida: BACKGROUND_TASKS_ENABLED=false no se admite en production (desactiva las transiciones automáticas de período y la limpieza de exportaciones y archivos).');
  }
  const ignoreEnvFile = booleanFlag(environment.IGNORE_ENV_FILE, 'IGNORE_ENV_FILE', false);
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
  if (production && (redisPassword === undefined || redisPassword.trim().length === 0)) {
    throw new Error('Configuración inválida: REDIS_PASSWORD es obligatorio en production.');
  }
  if (production) {
    // Detrás de un proxy, sin TRUST_PROXY todos los clientes comparten la IP del proxy (un límite
    // por IP los bloquearía a todos a la vez); con `true` cualquiera falsifica X-Forwarded-For.
    if (typeof environment.TRUST_PROXY !== 'string' || environment.TRUST_PROXY.trim().length === 0) {
      throw new Error('Configuración inválida: TRUST_PROXY es obligatorio en production (false, número de saltos o lista de subredes).');
    }
    if (trustProxy === true) {
      throw new Error('Configuración inválida: TRUST_PROXY=true no se admite en production porque confía en cualquier X-Forwarded-For; indica el número de saltos o las subredes del proxy.');
    }
  }
  const issuerConfigured = requiredString(environment.AUTH_ISSUER ?? `http://127.0.0.1:${portValue}`, 'AUTH_ISSUER');
  const issuerUrl = new URL(issuerConfigured);
  return {
    NODE_ENV: nodeEnv,
    PORT: portValue,
    SWAGGER_ENABLED: swagger,
    DB_HOST: requiredString(environment.DB_HOST ?? 'localhost', 'DB_HOST'),
    DB_PORT: port(environment.DB_PORT, 'DB_PORT', '5432'),
    DB_SSL: dbSsl,
    DB_SSL_REJECT_UNAUTHORIZED: dbSslRejectUnauthorized,
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
    ...(typeof redisPassword === 'string' && redisPassword.length > 0 ? { REDIS_PASSWORD: redisPassword } : {}),
    REDIS_TLS: redisTls,
    ...(typeof environment.SMTP_HOST === 'string' ? { SMTP_HOST: requiredString(environment.SMTP_HOST, 'SMTP_HOST') } : {}),
    SMTP_PORT: smtpPort,
    SMTP_REQUIRE_TLS: smtpRequireTls,
    ...(typeof environment.SMTP_USERNAME === 'string' ? { SMTP_USERNAME: environment.SMTP_USERNAME } : {}),
    ...(typeof environment.SMTP_PASSWORD === 'string' ? { SMTP_PASSWORD: environment.SMTP_PASSWORD } : {}),
    ...(typeof environment.SMTP_FROM === 'string' ? { SMTP_FROM: requiredString(environment.SMTP_FROM, 'SMTP_FROM') } : {}),
    ...(typeof environment.S3_ENDPOINT === 'string' ? { S3_ENDPOINT: httpsOrLoopbackUrl(environment.S3_ENDPOINT, 'S3_ENDPOINT', environment.S3_ENDPOINT, nodeEnv === 'production') } : {}),
    S3_REGION: typeof environment.S3_REGION === 'string' ? environment.S3_REGION : 'us-east-1',
    ...(typeof environment.S3_BUCKET === 'string' ? { S3_BUCKET: requiredString(environment.S3_BUCKET, 'S3_BUCKET') } : {}),
    ...(typeof environment.S3_ACCESS_KEY === 'string' ? { S3_ACCESS_KEY: environment.S3_ACCESS_KEY } : {}),
    ...(typeof environment.S3_SECRET_KEY === 'string' ? { S3_SECRET_KEY: environment.S3_SECRET_KEY } : {}),
    ...(typeof outboxKeyPath === 'string' ? { OUTBOX_ENCRYPTION_KEY_PATH: outboxKeyPath } : {}),
    TRUST_PROXY: trustProxy,
    IMPORT_TEMP_TTL_HOURS: importTempTtlHours,
    BACKGROUND_TASKS_ENABLED: backgroundTasks,
    IGNORE_ENV_FILE: ignoreEnvFile,
  };
}
