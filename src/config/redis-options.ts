import type { AppEnvironment } from './environment.js';

export type RedisEnvironment = Pick<AppEnvironment, 'REDIS_HOST' | 'REDIS_PORT' | 'REDIS_PASSWORD' | 'REDIS_TLS'>;

export interface RedisConnectionBase {
  host: string;
  port: number;
  password?: string;
  tls?: Record<string, never>;
}

/**
 * Conexión Redis común (host, puerto, contraseña y TLS). La usan tanto BullMQ como el
 * limitador de solicitudes para que la configuración de transporte no pueda divergir.
 * No fija plazos por comando (`commandTimeout`): BullMQ usa comandos bloqueantes y el plazo
 * corto solo lo añade el cliente del limitador.
 */
export function redisConnectionBase(environment: RedisEnvironment): RedisConnectionBase {
  return {
    host: environment.REDIS_HOST ?? '127.0.0.1',
    port: environment.REDIS_PORT,
    ...(environment.REDIS_PASSWORD ? { password: environment.REDIS_PASSWORD } : {}),
    ...(environment.REDIS_TLS === true ? { tls: {} } : {}),
  };
}
