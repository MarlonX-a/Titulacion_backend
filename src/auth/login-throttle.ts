import { HttpException, HttpStatus, type Logger } from '@nestjs/common';
import type { EventoSeguridad } from '../auditoria/auditoria.service.js';
import type { AuthRateLimiterService } from './auth-rate-limiter.service.js';
import { generateOneTimeSecret, tokenDigest } from './credentials.js';

/** Vigencia del dispositivo conocido (cookie y registro en Redis): 90 días. */
export const DEVICE_TTL_SECONDS = 90 * 24 * 60 * 60;

interface Bucket {
  nombre: 'ip' | 'correo' | 'dispositivo';
  key: string;
  limit: number;
  windowSeconds: number;
}

const IP_FAILURE_LIMIT = 30;
const IP_WINDOW_SECONDS = 60;
const EMAIL_FAILURE_LIMIT = 10;
const EMAIL_WINDOW_SECONDS = 900;
const DEVICE_FAILURE_LIMIT = 10;
const DEVICE_WINDOW_SECONDS = 900;
/** Detector de ataque: no bloquea, solo registra `FUERZA_BRUTA_SOSPECHADA`. */
const ATTACK_THRESHOLD = 50;
const ATTACK_WINDOW_SECONDS = 3600;
/** Un `LOGIN_FALLIDO` por (usuario, IP) en esta ventana; el log técnico registra todos. */
const FAILED_EVENT_WINDOW_SECONDS = 900;

export interface IntentoLogin {
  ip: string;
  emailDigest: string;
  /** SHA-256 de la cookie de dispositivo presentada, si la hay. */
  deviceHash: string | null;
  deviceCookie: string | null;
  /** El dispositivo ya inició sesión antes con este mismo correo. */
  trusted: boolean;
  /** Contadores en los que este intento reservó un cupo (se devuelven si no es un fallo). */
  reservas: string[];
}

export type RegistrarEvento = (evento: EventoSeguridad, usuarioId: string | null, ip: string, detalles?: Record<string, unknown>) => Promise<void>;

/**
 * Límites del inicio de sesión con cookie de dispositivo (diseño S1, §1). Antes de verificar la
 * contraseña solo distinguen al atacante de la víctima la IP y si el navegador ya entró antes a
 * esa cuenta: un intento desde un dispositivo conocido usa su propio contador y no lo afectan los
 * contadores por IP ni por correo.
 *
 * Reservar y devolver: antes de verificar la contraseña cada intento reserva atómicamente un cupo
 * en cada contador aplicable (429 si alguno está lleno). Un fallo conserva las reservas, que son
 * el recuento de fallos; cualquier otro resultado las devuelve. Así solo consumen cupo los fallos,
 * pero los intentos en curso cuentan mientras se verifican: una ráfaga simultánea no puede
 * superar el límite.
 */
export class LoginThrottle {
  constructor(
    private readonly limiter: AuthRateLimiterService,
    private readonly registrar: RegistrarEvento,
    private readonly buscarUsuario: (email: string) => Promise<string | null>,
    private readonly logger: Logger,
  ) {}

  /** Reserva un cupo en cada contador aplicable; 429 (sin reservas pendientes) si alguno está lleno. */
  async begin(email: string, ip: string, deviceCookie?: string): Promise<IntentoLogin> {
    const emailDigest = tokenDigest(email);
    const cookie = deviceCookie && deviceCookie.length <= 128 ? deviceCookie : null;
    const deviceHash = cookie ? tokenDigest(cookie) : null;
    const trusted = deviceHash !== null && await this.limiter.recall(deviceKey(deviceHash)) === emailDigest;
    const intento: IntentoLogin = { ip, emailDigest, deviceHash, deviceCookie: cookie, trusted, reservas: [] };
    for (const bucket of this.buckets(intento)) {
      let reservado: boolean;
      try {
        reservado = await this.limiter.reserve(bucket.key, bucket.limit, bucket.windowSeconds);
      } catch (error: unknown) {
        await this.refund(intento);
        throw error;
      }
      if (!reservado) {
        await this.refund(intento);
        await this.eventoUnaVez(`evt-bloqueo:${bucket.key}`, bucket.windowSeconds, 'LOGIN_BLOQUEADO', () => this.buscarUsuario(email), ip, { limite: bucket.nombre });
        throw new HttpException('Se alcanzó el límite de solicitudes. Inténtalo más tarde.', HttpStatus.TOO_MANY_REQUESTS);
      }
      intento.reservas.push(bucket.key);
    }
    return intento;
  }

  /**
   * Devuelve los cupos reservados por un intento que no fue un fallo de credenciales (login
   * correcto, primer acceso o error interno). Un fallo de Redis aquí solo se registra: el cupo
   * vence con su ventana.
   */
  async refund(intento: IntentoLogin): Promise<void> {
    const reservas = intento.reservas.splice(0);
    for (const key of reservas) {
      try {
        await this.limiter.release(key);
      } catch {
        this.logger.warn('No se pudo devolver un cupo reservado del inicio de sesión.');
      }
    }
  }

  /** Registra un intento fallido (401): sus reservas quedan como fallos. `usuarioId` es `null` si el correo no existe. */
  async failed(intento: IntentoLogin, usuarioId: string | null): Promise<void> {
    intento.reservas = [];
    const total = await this.limiter.hit(`login-email-total:${intento.emailDigest}`, ATTACK_WINDOW_SECONDS);
    this.logger.warn(`Inicio de sesión fallido (correo ${intento.emailDigest.slice(0, 12)}, IP ${intento.ip}, cuenta ${usuarioId ? 'existente' : 'desconocida'}).`);
    if (usuarioId !== null) {
      await this.eventoUnaVez(`evt-fallo:${usuarioId}:${intento.ip}`, FAILED_EVENT_WINDOW_SECONDS, 'LOGIN_FALLIDO', () => Promise.resolve(usuarioId), intento.ip, { dispositivo_conocido: intento.trusted });
    }
    if (total >= ATTACK_THRESHOLD) {
      await this.eventoUnaVez(`evt-fuerza:${intento.emailDigest}`, ATTACK_WINDOW_SECONDS, 'FUERZA_BRUTA_SOSPECHADA', () => Promise.resolve(usuarioId), intento.ip, { intentos: total });
    }
  }

  /**
   * Tras un inicio de sesión completo: vacía el contador del dispositivo y (re)registra la cookie
   * para este correo. Devuelve la cookie que se debe enviar, o `undefined` si Redis falló (el
   * inicio de sesión ya es válido y no se convierte en 503 por esto).
   */
  async succeeded(intento: IntentoLogin): Promise<string | undefined> {
    const cookie = intento.trusted && intento.deviceCookie ? intento.deviceCookie : generateOneTimeSecret();
    try {
      if (intento.trusted && intento.deviceHash) await this.limiter.reset(deviceFailureKey(intento.deviceHash));
      await this.limiter.remember(deviceKey(tokenDigest(cookie)), intento.emailDigest, DEVICE_TTL_SECONDS);
      return cookie;
    } catch {
      this.logger.warn('No se pudo registrar el dispositivo del inicio de sesión.');
      return undefined;
    }
  }

  private buckets(intento: IntentoLogin): Bucket[] {
    if (intento.trusted && intento.deviceHash) {
      return [{ nombre: 'dispositivo', key: deviceFailureKey(intento.deviceHash), limit: DEVICE_FAILURE_LIMIT, windowSeconds: DEVICE_WINDOW_SECONDS }];
    }
    return [
      { nombre: 'ip', key: `login-ip-fail:${intento.ip}`, limit: IP_FAILURE_LIMIT, windowSeconds: IP_WINDOW_SECONDS },
      { nombre: 'correo', key: `login-email-fail:${intento.emailDigest}`, limit: EMAIL_FAILURE_LIMIT, windowSeconds: EMAIL_WINDOW_SECONDS },
    ];
  }

  /** Registra el evento si su marca `SET NX` no existía. Un fallo aquí nunca cambia la respuesta. */
  private async eventoUnaVez(
    marca: string, ttlSeconds: number, evento: EventoSeguridad, usuario: () => Promise<string | null>, ip: string, detalles: Record<string, unknown>,
  ): Promise<void> {
    try {
      if (!await this.limiter.rememberOnce(marca, ttlSeconds)) return;
      await this.registrar(evento, await usuario(), ip, detalles);
    } catch {
      this.logger.warn(`No se pudo registrar el evento de seguridad ${evento}.`);
    }
  }
}

function deviceKey(deviceHash: string): string {
  return `device:${deviceHash}`;
}

function deviceFailureKey(deviceHash: string): string {
  return `login-dev-fail:${deviceHash}`;
}
