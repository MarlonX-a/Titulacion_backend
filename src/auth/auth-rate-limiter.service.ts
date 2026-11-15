import { HttpException, HttpStatus, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { AppEnvironment } from '../config/environment.js';
import { LimitadorNoDisponibleException } from '../common/exceptions/limitador-no-disponible.exception.js';
import { redisConnectionBase } from '../config/redis-options.js';

/**
 * Qué hacer si Redis no responde: `rechazar` (503, falla cerrado) o `permitir` (la solicitud
 * sigue sin contarse, falla abierto). Solo el límite global antiabuso usa `permitir`.
 */
export interface OpcionesLimite { siRedisFalla?: 'rechazar' | 'permitir' }

/** Intervalo mínimo entre dos registros del mismo fallo de Redis. */
const INTERVALO_REGISTRO_FALLO_MS = 30_000;
/** Plazo de cada comando y de la primera conexión del limitador. */
const TIEMPO_MAXIMO_COMANDO_MS = 1_500;

const RESERVAR = "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]); end; "
  + "if count > tonumber(ARGV[1]) then redis.call('DECR', KEYS[1]); return 0; end; return 1";
const DEVOLVER = "local count = tonumber(redis.call('GET', KEYS[1]) or '0'); if count > 0 then redis.call('DECR', KEYS[1]); end; return count";
const INCREMENTAR = "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return count";

/**
 * Limitador de solicitudes compartido (autenticación y `@RateLimit`) sobre un único cliente
 * Redis. Por defecto falla cerrado: si Redis no responde, la solicitud se rechaza con 503. El
 * límite global de toda ruta sin `@RateLimit` falla abierto (`siRedisFalla: 'permitir'`) para
 * que una caída de Redis no deje fuera de servicio toda la API. También guarda los registros
 * breves de la autenticación (dispositivos conocidos y eventos ya auditados).
 */
@Injectable()
export class AuthRateLimiterService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly redis: Redis;
  private readonly logger = new Logger(AuthRateLimiterService.name);
  private ultimoRegistroFallo = Number.NEGATIVE_INFINITY;
  private redisCaido = false;

  constructor(config: ConfigService<AppEnvironment, true>) {
    this.redis = new Redis({
      ...redisConnectionBase({
        REDIS_HOST: config.get('REDIS_HOST', { infer: true }),
        REDIS_PORT: config.get('REDIS_PORT', { infer: true }),
        REDIS_PASSWORD: config.get('REDIS_PASSWORD', { infer: true }),
        REDIS_TLS: config.get('REDIS_TLS', { infer: true }),
      }),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 5_000,
      // Un Redis conectado pero mudo no debe colgar solicitudes: cada comando falla a los 1,5 s
      // (503 o paso libre según el modo). Solo este cliente: BullMQ usa comandos bloqueantes.
      commandTimeout: TIEMPO_MAXIMO_COMANDO_MS,
      retryStrategy: (attempt: number) => Math.min(500 * 2 ** Math.min(attempt - 1, 6), 30_000),
    });
    this.redis.on('error', (error: unknown) => this.registrarFallo(error));
  }

  /** Comprueba Redis al arrancar sin bloquear ni abortar el arranque; solo advierte si falla. */
  onApplicationBootstrap(): void {
    void this.comprobarConexion();
  }

  async comprobarConexion(): Promise<void> {
    try {
      await this.connect();
      await this.redis.ping();
    } catch (error: unknown) {
      this.logger.warn(`Redis no responde al arrancar; los límites de autenticación y de @RateLimit responderán 503 hasta que vuelva (${describirError(error)}).`);
    }
  }

  /** Cuenta la solicitud actual y rechaza cuando el contador supera el límite de la ventana. */
  async enforce(key: string, limit: number, windowSeconds: number, opciones: OpcionesLimite = {}): Promise<void> {
    try {
      await this.guard(async () => {
        if ((await this.increment(key, windowSeconds)) > limit) throw tooManyRequests();
      });
    } catch (error: unknown) {
      if (opciones.siRedisFalla === 'permitir' && error instanceof LimitadorNoDisponibleException) return;
      throw error;
    }
  }

  /**
   * Reserva atómicamente un cupo: incrementa el contador y, si supera el límite, deshace el
   * incremento y devuelve `false`. Un solo script Lua, sin carreras entre solicitudes simultáneas.
   */
  async reserve(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    return this.guard(async () => {
      await this.connect();
      return Number(await this.redis.eval(RESERVAR, 1, redisKey(key), String(limit), String(windowSeconds))) === 1;
    });
  }

  /** Devuelve un cupo tomado con `reserve`; nunca deja el contador por debajo de cero. */
  async release(key: string): Promise<void> {
    await this.guard(async () => {
      await this.connect();
      await this.redis.eval(DEVOLVER, 1, redisKey(key));
    });
  }

  /** Rechaza si el contador ya alcanzó el límite, sin contar la solicitud actual. */
  async assertBelow(key: string, limit: number): Promise<void> {
    await this.guard(async () => {
      await this.connect();
      if (Number(await this.redis.get(redisKey(key)) ?? 0) >= limit) throw tooManyRequests();
    });
  }

  /** Suma un evento (por ejemplo, un intento fallido) al contador de la ventana y devuelve el total. */
  async hit(key: string, windowSeconds: number): Promise<number> {
    return this.guard(() => this.increment(key, windowSeconds));
  }

  /** Elimina un contador o registro. */
  async reset(key: string): Promise<void> {
    await this.guard(async () => {
      await this.connect();
      await this.redis.del(redisKey(key));
    });
  }

  /** Guarda un valor con vencimiento, reemplazando el anterior. */
  async remember(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.guard(async () => {
      await this.connect();
      await this.redis.set(redisKey(key), value, 'EX', ttlSeconds);
    });
  }

  /**
   * Guarda una marca solo si no existe (`SET NX`) y devuelve si la creó. Sirve para registrar
   * un evento como máximo una vez por ventana.
   */
  async rememberOnce(key: string, ttlSeconds: number): Promise<boolean> {
    return this.guard(async () => {
      await this.connect();
      return (await this.redis.set(redisKey(key), '1', 'EX', ttlSeconds, 'NX')) === 'OK';
    });
  }

  /** Valor guardado con `remember`, o `null` si no existe o venció. */
  async recall(key: string): Promise<string | null> {
    return this.guard(async () => {
      await this.connect();
      return await this.redis.get(redisKey(key));
    });
  }

  private async increment(key: string, windowSeconds: number): Promise<number> {
    await this.connect();
    return Number(await this.redis.eval(INCREMENTAR, 1, redisKey(key), String(windowSeconds)));
  }

  /**
   * Primera conexión con plazo: `connect()` de ioredis espera al `ready`, que nunca llega si el
   * servidor acepta el socket pero no responde. Las solicitudes posteriores no esperan (sin cola
   * offline, un comando con la conexión a medias se rechaza al instante).
   */
  private async connect(): Promise<void> {
    if (this.redis.status !== 'wait') return;
    const conexion = this.redis.connect();
    conexion.catch(() => undefined);
    let temporizador: NodeJS.Timeout | undefined;
    const plazo = new Promise<never>((_resolve, reject) => {
      temporizador = setTimeout(() => reject(new Error(`Redis no completó la conexión en ${TIEMPO_MAXIMO_COMANDO_MS} ms.`)), TIEMPO_MAXIMO_COMANDO_MS);
    });
    try {
      await Promise.race([conexion, plazo]);
    } finally {
      clearTimeout(temporizador);
    }
  }

  private async guard<T>(operation: () => Promise<T>): Promise<T> {
    let result: T;
    try {
      result = await operation();
    } catch (error: unknown) {
      if (error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS) {
        this.registrarRecuperacion();
        throw error;
      }
      this.registrarFallo(error);
      // Clase propia: el filtro de errores no registra este 503 por solicitud (registrarFallo ya lo hizo).
      throw new LimitadorNoDisponibleException(error);
    }
    this.registrarRecuperacion();
    return result;
  }

  /** Registra la causa (clase, código y mensaje; nunca credenciales) como máximo una vez por intervalo. */
  private registrarFallo(error: unknown): void {
    this.redisCaido = true;
    const ahora = Date.now();
    if (ahora - this.ultimoRegistroFallo < INTERVALO_REGISTRO_FALLO_MS) return;
    this.ultimoRegistroFallo = ahora;
    this.logger.warn(`Redis no disponible para el limitador de solicitudes (${describirError(error)}).`);
  }

  private registrarRecuperacion(): void {
    if (!this.redisCaido) return;
    this.redisCaido = false;
    this.ultimoRegistroFallo = Number.NEGATIVE_INFINITY;
    this.logger.log('Redis vuelve a responder al limitador de solicitudes.');
  }

  async onModuleDestroy(): Promise<void> { await this.redis.quit().catch(() => undefined); }
}

/** Clase, código y mensaje del error, acotados. Los errores de ioredis no incluyen la contraseña. */
function describirError(error: unknown): string {
  if (!(error instanceof Error)) return 'error desconocido';
  const codigo = (error as { code?: unknown }).code;
  return `${error.name}${typeof codigo === 'string' ? ` ${codigo}` : ''}: ${error.message.slice(0, 200)}`;
}

function redisKey(key: string): string {
  return `titulacion:auth-rate:${key}`;
}

function tooManyRequests(): HttpException {
  return new HttpException('Se alcanzó el límite de solicitudes. Inténtalo más tarde.', HttpStatus.TOO_MANY_REQUESTS);
}
