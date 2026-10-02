export type NodeEnvironment = 'development' | 'test' | 'production';
export type AuthenticationMode = 'institutional' | 'local';

export interface AppEnvironment {
  NODE_ENV: NodeEnvironment;
  AUTH_MODE: AuthenticationMode;
  PORT: number;
  SWAGGER_ENABLED: boolean;
  DB_HOST: string;
  DB_PORT: number;
  DB_SCHEMA: string;
  DB_USERNAME: string;
  DB_PASSWORD: string;
  DB_NAME: string;
  OIDC_ISSUER?: string;
  OIDC_AUDIENCE?: string;
  JWKS_URI?: string;
  LOCAL_AUTH_PASSWORD?: string;
}

function validatePort(value: unknown, name: string): number {
  const port =
    typeof value === 'string' && /^\d+$/.test(value)
      ? Number(value)
      : Number.NaN;

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Configuración inválida: ${name} debe ser un entero entre 1 y 65535.`,
    );
  }

  return port;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `Configuración inválida: ${name} es obligatorio y no puede estar vacío.`,
    );
  }

  return value;
}

function validateAuthenticationConfiguration(
  environment: Record<string, unknown>,
  nodeEnv: NodeEnvironment,
  authMode: AuthenticationMode,
): Pick<
  AppEnvironment,
  'OIDC_ISSUER' | 'OIDC_AUDIENCE' | 'JWKS_URI' | 'LOCAL_AUTH_PASSWORD'
> {
  const names = ['OIDC_ISSUER', 'OIDC_AUDIENCE', 'JWKS_URI'] as const;
  const supplied = names.filter((name) => environment[name] !== undefined);

  if (authMode === 'local') {
    if (nodeEnv === 'production') {
      throw new Error(
        'Configuración inválida: AUTH_MODE=local solo se permite en desarrollo y pruebas.',
      );
    }
    if (supplied.length > 0) {
      throw new Error(
        'Configuración inválida: no se pueden combinar AUTH_MODE=local y autenticación OIDC.',
      );
    }
    const password = requiredString(
      environment.LOCAL_AUTH_PASSWORD,
      'LOCAL_AUTH_PASSWORD',
    );
    if (password.length < 16 || password.trim().length < 16) {
      throw new Error(
        'Configuración inválida: LOCAL_AUTH_PASSWORD debe tener al menos 16 caracteres.',
      );
    }
    return { LOCAL_AUTH_PASSWORD: password };
  }

  if (environment.LOCAL_AUTH_PASSWORD !== undefined) {
    throw new Error(
      'Configuración inválida: LOCAL_AUTH_PASSWORD solo se permite con AUTH_MODE=local.',
    );
  }

  if (nodeEnv === 'production' || supplied.length > 0) {
    for (const name of names) {
      if (environment[name] === undefined) {
        throw new Error(
          `Configuración inválida: ${name} es obligatoria cuando se configura autenticación.`,
        );
      }
    }
  }

  if (supplied.length === 0) {
    return {};
  }

  const issuer = requiredString(environment.OIDC_ISSUER, 'OIDC_ISSUER');
  const audience = requiredString(environment.OIDC_AUDIENCE, 'OIDC_AUDIENCE');
  const jwksUri = requiredString(environment.JWKS_URI, 'JWKS_URI');
  const allowLoopbackHttp = nodeEnv !== 'production';

  validateHttpUrl(issuer, 'OIDC_ISSUER', allowLoopbackHttp);
  validateHttpUrl(jwksUri, 'JWKS_URI', allowLoopbackHttp);

  return { OIDC_ISSUER: issuer, OIDC_AUDIENCE: audience, JWKS_URI: jwksUri };
}

function validateHttpUrl(
  value: string,
  name: 'OIDC_ISSUER' | 'JWKS_URI',
  allowLoopbackHttp: boolean,
): void {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`Configuración inválida: ${name} debe ser una URL válida.`);
  }

  const isLoopback =
    url.hostname === 'localhost' ||
    url.hostname.startsWith('127.') ||
    url.hostname === '[::1]' ||
    url.hostname === '::1';
  const isSecure = url.protocol === 'https:';
  const isAllowedLoopback =
    allowLoopbackHttp && isLoopback && url.protocol === 'http:';

  if (
    (!isSecure && !isAllowedLoopback) ||
    url.hostname.length === 0 ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error(
      `Configuración inválida: ${name} debe usar HTTPS (HTTP solo se permite para pruebas locales).`,
    );
  }
}

export function validateEnvironment(
  environment: Record<string, unknown>,
): AppEnvironment {
  const nodeEnv =
    environment.NODE_ENV === undefined ? 'development' : environment.NODE_ENV;

  if (
    nodeEnv !== 'development' &&
    nodeEnv !== 'test' &&
    nodeEnv !== 'production'
  ) {
    throw new Error(
      'Configuración inválida: NODE_ENV debe ser development, test o production.',
    );
  }

  const rawPort = environment.PORT === undefined ? '3000' : environment.PORT;
  const port = validatePort(rawPort, 'PORT');

  const authMode =
    environment.AUTH_MODE === undefined ? 'institutional' : environment.AUTH_MODE;
  if (authMode !== 'institutional' && authMode !== 'local') {
    throw new Error(
      'Configuración inválida: AUTH_MODE debe ser institutional o local.',
    );
  }

  const dbSchema =
    environment.DB_SCHEMA === undefined ? 'public' : environment.DB_SCHEMA;
  if (
    typeof dbSchema !== 'string' ||
    !/^[a-z][a-z0-9_]{0,62}$/.test(dbSchema)
  ) {
    throw new Error(
      'Configuración inválida: DB_SCHEMA debe ser un identificador PostgreSQL válido.',
    );
  }
  if (authMode === 'local') {
    const host = environment.DB_HOST === undefined ? 'localhost' : environment.DB_HOST;
    const isLoopback =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]';
    if (!isLoopback) {
      throw new Error(
        'Configuración inválida: DB_HOST debe apuntar a localhost en modo local.',
      );
    }
    if (dbSchema !== 'local_demo') {
      throw new Error(
        'Configuración inválida: DB_SCHEMA debe ser local_demo en modo local.',
      );
    }
  } else if (dbSchema === 'local_demo') {
    throw new Error(
      'Configuración inválida: DB_SCHEMA=local_demo solo se permite en modo local.',
    );
  }

  const rawSwaggerEnabled = environment.SWAGGER_ENABLED;

  if (
    rawSwaggerEnabled !== undefined &&
    rawSwaggerEnabled !== 'true' &&
    rawSwaggerEnabled !== 'false'
  ) {
    throw new Error(
      'Configuración inválida: SWAGGER_ENABLED debe ser true o false.',
    );
  }

  return {
    NODE_ENV: nodeEnv,
    AUTH_MODE: authMode,
    PORT: port,
    SWAGGER_ENABLED:
      rawSwaggerEnabled === undefined
        ? nodeEnv !== 'production'
        : rawSwaggerEnabled === 'true',
    DB_HOST: requiredString(
      environment.DB_HOST === undefined ? 'localhost' : environment.DB_HOST,
      'DB_HOST',
    ),
    DB_PORT: validatePort(
      environment.DB_PORT === undefined ? '5432' : environment.DB_PORT,
      'DB_PORT',
    ),
    DB_SCHEMA: dbSchema,
    DB_USERNAME: requiredString(environment.DB_USERNAME, 'DB_USERNAME'),
    DB_PASSWORD: requiredString(environment.DB_PASSWORD, 'DB_PASSWORD'),
    DB_NAME: requiredString(environment.DB_NAME, 'DB_NAME'),
    ...validateAuthenticationConfiguration(environment, nodeEnv, authMode),
  };
}
