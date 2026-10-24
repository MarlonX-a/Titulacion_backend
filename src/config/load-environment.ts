import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { validateEnvironment, type AppEnvironment } from './environment.js';

// El CLI usa el mismo parser de Node y la misma precedencia que ConfigModule.
export function loadEnvironment(
  envFilePath = '.env',
  environment: NodeJS.ProcessEnv = process.env,
): AppEnvironment {
  let fileEnvironment: NodeJS.ProcessEnv = {};

  try {
    fileEnvironment = parseEnv(readFileSync(envFilePath, 'utf8'));
  } catch (error: unknown) {
    if (!(
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    )) {
      throw new Error(
        'No se pudo leer el archivo de configuración del entorno.',
      );
    }
  }

  return validateEnvironment({ ...fileEnvironment, ...environment });
}
