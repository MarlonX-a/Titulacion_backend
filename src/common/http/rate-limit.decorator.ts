import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT = 'rateLimit';

export interface RateLimitOptions {
  /** Nombre del contador (minúsculas, dígitos y guiones), p. ej. `subir-pat`. */
  clave: string;
  /** Solicitudes admitidas dentro de la ventana. */
  limite: number;
  ventanaSegundos: number;
  /**
   * Sujeto del contador. Por defecto, el usuario autenticado; `ip` cuenta por dirección aunque
   * haya sesión. Las solicitudes anónimas siempre se cuentan por IP.
   */
  por?: 'usuario' | 'ip';
  /**
   * Solicitudes simultáneas admitidas por sujeto (`rl:{clave}:concurrentes:{sujeto}`). El cupo se
   * toma en el guard, antes de multer, y se devuelve al terminar la respuesta o al cerrarse la
   * conexión. `ttlSegundos` es la red de seguridad: si el proceso cae con el cupo tomado, Redis lo
   * libera al vencer. Excederlo responde 429; sin Redis, 503 (igual que el límite por ventana).
   */
  concurrencia?: { limite: number; ttlSegundos: number };
}

/**
 * Límites globales aplicados a toda ruta HTTP sin `@RateLimit`. Son holgados a propósito: solo
 * cortan abusos evidentes. El de IP anónima es mayor porque en el campus muchos usuarios
 * pueden compartir una misma IP pública (NAT). Fallan abiertos: si Redis no responde, la
 * solicitud continúa sin contarse.
 */
export const LIMITE_GLOBAL_USUARIO: Readonly<RateLimitOptions> = { clave: 'global', limite: 600, ventanaSegundos: 60, por: 'usuario' };
export const LIMITE_GLOBAL_IP: Readonly<RateLimitOptions> = { clave: 'global', limite: 3000, ventanaSegundos: 60, por: 'ip' };

/**
 * Limita la ruta con un contador propio en Redis (`rl:{clave}:{usuario o IP}`), en lugar del
 * límite global. Se evalúa en un guard, antes de interceptores como multer, de modo que una
 * subida rechazada no llega a recibirse en memoria. Falla cerrado: si Redis no responde, 503.
 */
export function RateLimit(options: RateLimitOptions): MethodDecorator & ClassDecorator {
  if (!/^[a-z0-9-]{1,40}$/.test(options.clave)) throw new Error('RateLimit: la clave debe usar minúsculas, dígitos o guiones.');
  if (!Number.isInteger(options.limite) || options.limite < 1) throw new Error('RateLimit: el límite debe ser un entero positivo.');
  if (!Number.isInteger(options.ventanaSegundos) || options.ventanaSegundos < 1) throw new Error('RateLimit: la ventana debe ser un entero positivo de segundos.');
  const { concurrencia } = options;
  if (concurrencia && (!Number.isInteger(concurrencia.limite) || concurrencia.limite < 1 || !Number.isInteger(concurrencia.ttlSegundos) || concurrencia.ttlSegundos < 1)) {
    throw new Error('RateLimit: la concurrencia requiere un límite y un vencimiento enteros positivos.');
  }
  return SetMetadata(RATE_LIMIT, { ...options, ...(concurrencia ? { concurrencia: { ...concurrencia } } : {}) });
}
