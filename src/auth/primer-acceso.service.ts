import { Injectable, Logger } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { NotificacionesPersistenciaService } from '../notificaciones/notificaciones-persistencia.service.js';
import { AuthRateLimiterService } from './auth-rate-limiter.service.js';

/** Activaciones desde una misma IP, dentro de la ventana, a partir de las cuales se alerta a ADMIN. */
export const UMBRAL_ACTIVACIONES_POR_IP = 3;
export const VENTANA_ACTIVACIONES_SEGUNDOS = 3600;
const SAVEPOINT = 'aviso_primer_acceso';

/**
 * Mitigaciones del primer acceso con la cédula como clave temporal (S2): avisa al titular cuando
 * su cuenta se activa y alerta a ADMIN si una misma dirección activa varias cuentas. Ningún
 * fallo de estos avisos puede deshacer o hacer fallar el cambio de contraseña.
 */
@Injectable()
export class PrimerAccesoService {
  private readonly logger = new Logger(PrimerAccesoService.name);

  constructor(
    private readonly limiter: AuthRateLimiterService,
    private readonly auditoria: AuditoriaService,
    private readonly notificaciones: NotificacionesPersistenciaService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Crea el aviso al titular dentro de la transacción del cambio de contraseña, pero aislado en un
   * SAVEPOINT: si el aviso falla se revierte solo él, se registra el fallo y la transacción sigue.
   */
  async avisarAlTitular(manager: EntityManager, usuarioId: string): Promise<void> {
    await manager.query(`SAVEPOINT ${SAVEPOINT}`);
    try {
      await this.notificaciones.cuentaActivada(manager, usuarioId);
      await manager.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    } catch {
      await manager.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
      this.logger.warn('No se pudo registrar el aviso de activación de cuenta.');
    }
  }

  /**
   * Cuenta una activación completada desde `ip`. Al llegar al umbral registra un evento de
   * seguridad y avisa a cada ADMIN activo, una vez por IP y ventana. Se ejecuta tras confirmar el
   * cambio de contraseña y nunca lanza: si Redis o la base fallan solo se deja un registro técnico.
   */
  async vigilarActivacionesPorIp(ip: string): Promise<void> {
    const marca = `first-access-ip-alert:${ip}`;
    let marcada = false;
    try {
      const activaciones = await this.limiter.hit(`first-access-ip:${ip}`, VENTANA_ACTIVACIONES_SEGUNDOS);
      if (activaciones < UMBRAL_ACTIVACIONES_POR_IP) return;
      marcada = await this.limiter.rememberOnce(marca, VENTANA_ACTIVACIONES_SEGUNDOS);
      if (!marcada) return;
      await this.dataSource.transaction(async (manager) => {
        await this.auditoria.registrarEventoSeguridad(manager, 'PRIMER_ACCESO_MASIVO', { usuarioId: null, ip, detalles: { ip, activaciones } });
        await this.notificaciones.activacionesMasivas(manager, { ip, activaciones });
      });
    } catch {
      this.logger.warn('No se pudo evaluar la alerta de activaciones masivas.');
      // La alerta no quedó registrada: libera la marca para que la siguiente activación la reintente.
      if (marcada) await this.limiter.reset(marca).catch(() => undefined);
    }
  }
}
