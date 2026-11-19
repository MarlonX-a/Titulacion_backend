import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type { AppEnvironment } from '../config/environment.js';
import { PeriodosService } from './periodos.service.js';
import { ReservaTemaService } from '../postulaciones/reserva-tema.service.js';

export const COLA_TRANSICIONES_PERIODO = 'transiciones-periodo';
export const JOB_TRANSICIONES_PERIODO = 'aplicar-transiciones-por-fecha';
/** Identificador estable: `upsertJobScheduler` lo reutiliza en cada arranque y entre instancias. */
export const SCHEDULER_TRANSICIONES_PERIODO = 'transiciones-periodo-por-fecha';
export const INTERVALO_TRANSICIONES_MS = 60_000;

export interface ResumenTransicionesPeriodo {
  abiertos: number;
  cerrados: number;
  fallidos: number;
  /** Reservas PENDIENTE_CONFIRMACION vencidas por este barrido (48 h o plazo terminado). */
  reservasVencidas: number;
}

/**
 * Transiciones automáticas por fecha: BORRADOR → POSTULACION_ABIERTA y
 * POSTULACION_ABIERTA → POSTULACION_CERRADA, más el vencimiento de reservas de temas sin confirmar.
 * Las transiciones forzadas no requieren coordinación: cada transición vuelve a leer estado y fechas
 * bajo bloqueo, por lo que un período ya movido manualmente queda como no-op. No inicia la titulación (sigue siendo manual porque
 * suspende condicionados) ni reabre postulaciones cerradas.
 */
@Injectable()
export class TransicionesPeriodoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TransicionesPeriodoService.name);
  /** `BACKGROUND_TASKS_ENABLED`: programa el scheduler al arrancar y reintenta si Redis falla. */
  private readonly tareasActivas: boolean;
  private retry?: NodeJS.Timeout;

  constructor(
    private readonly periodos: PeriodosService,
    @InjectQueue(COLA_TRANSICIONES_PERIODO) private readonly queue: Queue,
    config: ConfigService<AppEnvironment, true>,
    /** Opcional solo para pruebas unitarias; Nest siempre lo inyecta (PostulacionesPersistenciaModule). */
    private readonly reservas?: ReservaTemaService,
  ) {
    this.tareasActivas = config.get('BACKGROUND_TASKS_ENABLED', { infer: true }) === true;
  }

  onModuleInit(): void {
    if (!this.tareasActivas) return;
    // Sin await: si Redis no está disponible, el arranque HTTP no debe quedar bloqueado.
    void this.programar();
  }

  onModuleDestroy(): void {
    if (this.retry) clearTimeout(this.retry);
  }

  async programar(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        SCHEDULER_TRANSICIONES_PERIODO,
        { every: INTERVALO_TRANSICIONES_MS },
        { name: JOB_TRANSICIONES_PERIODO, opts: { removeOnComplete: true, removeOnFail: 50 } },
      );
    } catch {
      this.logger.warn('No se pudo programar la transición automática de períodos; se reintentará en un minuto.');
      if (!this.tareasActivas) return;
      this.retry = setTimeout(() => void this.programar(), INTERVALO_TRANSICIONES_MS);
      this.retry.unref();
    }
  }

  /** Aplica cada transición en su propia transacción; un período fallido no detiene a los demás. */
  async ejecutar(now = new Date()): Promise<ResumenTransicionesPeriodo> {
    const candidatos = await this.periodos.candidatosTransicionAutomatica(now);
    const resumen: ResumenTransicionesPeriodo = { abiertos: 0, cerrados: 0, fallidos: 0, reservasVencidas: 0 };
    for (const id of candidatos.cierres) {
      if (await this.intentar('cerrar', id, () => this.periodos.cerrarPostulacionAutomatica(id), resumen)) resumen.cerrados += 1;
    }
    for (const id of candidatos.aperturas) {
      if (await this.intentar('abrir', id, () => this.periodos.abrirPostulacionAutomatica(id), resumen)) resumen.abiertos += 1;
    }
    if (this.reservas) {
      // Después de los cierres: las reservas de los períodos recién cerrados ya vencieron en su transacción.
      const vencimientos = await this.reservas.expirarVencidas(now).catch((error: unknown) => {
        this.logger.error(`No se pudo ejecutar el vencimiento de reservas de temas: ${error instanceof Error ? error.message : 'error no identificado'}.`);
        return { expiradas: 0, fallidas: 1 };
      });
      resumen.reservasVencidas = vencimientos.expiradas;
      resumen.fallidos += vencimientos.fallidas;
    }
    if (resumen.abiertos || resumen.cerrados || resumen.reservasVencidas) {
      this.logger.log(`Transiciones automáticas de períodos: ${resumen.abiertos} abiertos, ${resumen.cerrados} cerrados, ${resumen.reservasVencidas} reservas vencidas.`);
    }
    return resumen;
  }

  private async intentar(
    operacion: 'abrir' | 'cerrar',
    id: string,
    transicion: () => Promise<boolean>,
    resumen: ResumenTransicionesPeriodo,
  ): Promise<boolean> {
    try {
      return await transicion();
    } catch (error: unknown) {
      resumen.fallidos += 1;
      this.logger.error(
        `No se pudo ${operacion} automáticamente la postulación del período ${id}: ${error instanceof Error ? error.message : 'error no identificado'}.`,
      );
      return false;
    }
  }
}
