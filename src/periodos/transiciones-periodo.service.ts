import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PeriodosService } from './periodos.service.js';

export const COLA_TRANSICIONES_PERIODO = 'transiciones-periodo';
export const JOB_TRANSICIONES_PERIODO = 'aplicar-transiciones-por-fecha';
/** Identificador estable: `upsertJobScheduler` lo reutiliza en cada arranque y entre instancias. */
export const SCHEDULER_TRANSICIONES_PERIODO = 'transiciones-periodo-por-fecha';
export const INTERVALO_TRANSICIONES_MS = 60_000;

export interface ResumenTransicionesPeriodo {
  abiertos: number;
  cerrados: number;
  fallidos: number;
}

/**
 * Transiciones automáticas por fecha: BORRADOR → POSTULACION_ABIERTA y
 * POSTULACION_ABIERTA → POSTULACION_CERRADA. No inicia la titulación (sigue siendo manual porque
 * suspende condicionados) ni reabre postulaciones cerradas.
 */
@Injectable()
export class TransicionesPeriodoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TransicionesPeriodoService.name);
  private readonly testMode = process.env.NODE_ENV === 'test';
  private retry?: NodeJS.Timeout;

  constructor(
    private readonly periodos: PeriodosService,
    @InjectQueue(COLA_TRANSICIONES_PERIODO) private readonly queue: Queue,
  ) {}

  onModuleInit(): void {
    if (this.testMode) return;
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
      if (this.testMode) return;
      this.retry = setTimeout(() => void this.programar(), INTERVALO_TRANSICIONES_MS);
      this.retry.unref();
    }
  }

  /** Aplica cada transición en su propia transacción; un período fallido no detiene a los demás. */
  async ejecutar(now = new Date()): Promise<ResumenTransicionesPeriodo> {
    const candidatos = await this.periodos.candidatosTransicionAutomatica(now);
    const resumen: ResumenTransicionesPeriodo = { abiertos: 0, cerrados: 0, fallidos: 0 };
    for (const id of candidatos.cierres) {
      if (await this.intentar('cerrar', id, () => this.periodos.cerrarPostulacionAutomatica(id), resumen)) resumen.cerrados += 1;
    }
    for (const id of candidatos.aperturas) {
      if (await this.intentar('abrir', id, () => this.periodos.abrirPostulacionAutomatica(id), resumen)) resumen.abiertos += 1;
    }
    if (resumen.abiertos || resumen.cerrados) {
      this.logger.log(`Transiciones automáticas de períodos: ${resumen.abiertos} abiertos, ${resumen.cerrados} cerrados.`);
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
