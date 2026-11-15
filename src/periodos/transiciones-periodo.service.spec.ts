import { describe, expect, it, vi } from 'vitest';
import {
  INTERVALO_TRANSICIONES_MS,
  JOB_TRANSICIONES_PERIODO,
  SCHEDULER_TRANSICIONES_PERIODO,
  TransicionesPeriodoService,
} from './transiciones-periodo.service.js';
import { TransicionesPeriodoWorker } from './transiciones-periodo.worker.js';

function setup(tareasActivas = false) {
  const periodos = {
    candidatosTransicionAutomatica: vi.fn(async () => ({ aperturas: ['a-1', 'a-2'], cierres: ['c-1', 'c-2'] })),
    abrirPostulacionAutomatica: vi.fn(async (_id: string) => true),
    cerrarPostulacionAutomatica: vi.fn(async (_id: string) => true),
  };
  const queue = { upsertJobScheduler: vi.fn(async () => ({})) };
  const config = { get: vi.fn((clave: string) => (clave === 'BACKGROUND_TASKS_ENABLED' ? tareasActivas : undefined)) };
  const service = new TransicionesPeriodoService(periodos as never, queue as never, config as never);
  return { service, periodos, queue };
}

describe('TransicionesPeriodoService', () => {
  it('registra un único scheduler con id estable (idempotente entre reinicios)', async () => {
    const { service, queue } = setup();
    await service.programar();
    await service.programar();
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(2);
    for (const call of queue.upsertJobScheduler.mock.calls as unknown as Array<[string, { every: number }, { name: string }]>) {
      expect(call[0]).toBe(SCHEDULER_TRANSICIONES_PERIODO);
      expect(call[1]).toEqual({ every: INTERVALO_TRANSICIONES_MS });
      expect(call[2].name).toBe(JOB_TRANSICIONES_PERIODO);
    }
  });

  it('no propaga el fallo de Redis al programar', async () => {
    const { service, queue } = setup();
    queue.upsertJobScheduler.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.programar()).resolves.toBeUndefined();
  });

  it('no programa al iniciar el módulo con BACKGROUND_TASKS_ENABLED=false', () => {
    const { service, queue } = setup(false);
    service.onModuleInit();
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it('programa al iniciar el módulo con BACKGROUND_TASKS_ENABLED=true (valor de producción)', () => {
    const { service, queue } = setup(true);
    service.onModuleInit();
    service.onModuleDestroy();
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
  });

  it('aplica cierres y aperturas por período y un fallo no detiene a los demás', async () => {
    const { service, periodos } = setup();
    periodos.cerrarPostulacionAutomatica.mockRejectedValueOnce(new Error('deadlock'));
    periodos.abrirPostulacionAutomatica.mockResolvedValueOnce(false);
    const resumen = await service.ejecutar(new Date('2026-05-10T12:00:00Z'));
    expect(periodos.cerrarPostulacionAutomatica.mock.calls.map(([id]) => id)).toEqual(['c-1', 'c-2']);
    expect(periodos.abrirPostulacionAutomatica.mock.calls.map(([id]) => id)).toEqual(['a-1', 'a-2']);
    expect(resumen).toEqual({ abiertos: 1, cerrados: 1, fallidos: 1 });
  });
});

describe('TransicionesPeriodoWorker', () => {
  it('solo ejecuta el job de transiciones por fecha', async () => {
    const transiciones = { ejecutar: vi.fn(async () => ({ abiertos: 0, cerrados: 0, fallidos: 0 })) };
    const worker = new TransicionesPeriodoWorker(transiciones as never);
    await worker.process({ name: 'otro' } as never);
    expect(transiciones.ejecutar).not.toHaveBeenCalled();
    await worker.process({ name: JOB_TRANSICIONES_PERIODO } as never);
    expect(transiciones.ejecutar).toHaveBeenCalledTimes(1);
  });
});
