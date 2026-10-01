export type NodeEnvironment = 'development' | 'test' | 'production';

export interface AppEnvironment {
  NODE_ENV: NodeEnvironment;
  PORT: number;
  SWAGGER_ENABLED: boolean;
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_PASSWORD: string;
  DB_NAME: string;
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
    DB_USERNAME: requiredString(environment.DB_USERNAME, 'DB_USERNAME'),
    DB_PASSWORD: requiredString(environment.DB_PASSWORD, 'DB_PASSWORD'),
    DB_NAME: requiredString(environment.DB_NAME, 'DB_NAME'),
  };
}
