import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { NotificacionesPersistenciaService } from '../notificaciones/notificaciones-persistencia.service.js';
import { limiterMock } from '../../test/support/auth-service-fakes.js';
import type { AuthRateLimiterService } from './auth-rate-limiter.service.js';
import { PrimerAccesoService } from './primer-acceso.service.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const IP = '203.0.113.9';

function setup() {
  const limiter = limiterMock();
  const auditoria = { registrarEventoSeguridad: vi.fn().mockResolvedValue(undefined) };
  const notificaciones = { cuentaActivada: vi.fn().mockResolvedValue(undefined), activacionesMasivas: vi.fn().mockResolvedValue(2) };
  const manager = { query: vi.fn().mockResolvedValue(undefined) };
  const dataSource = { transaction: vi.fn((work: (value: typeof manager) => Promise<unknown>) => work(manager)) };
  const service = new PrimerAccesoService(
    limiter as unknown as AuthRateLimiterService, auditoria as unknown as AuditoriaService,
    notificaciones as unknown as NotificacionesPersistenciaService, dataSource as unknown as DataSource,
  );
  return { service, limiter, auditoria, notificaciones, manager, dataSource };
}

describe('PrimerAccesoService.avisarAlTitular', () => {
  it('crea el aviso dentro de un SAVEPOINT que se libera', async () => {
    const { service, notificaciones, manager } = setup();

    await service.avisarAlTitular(manager as unknown as EntityManager, USER_ID);

    expect(notificaciones.cuentaActivada).toHaveBeenCalledWith(manager, USER_ID);
    expect(manager.query.mock.calls.map((call) => call[0])).toEqual(['SAVEPOINT aviso_primer_acceso', 'RELEASE SAVEPOINT aviso_primer_acceso']);
  });

  it('si el aviso falla revierte solo el SAVEPOINT y no lanza (el cambio de contraseña sigue)', async () => {
    const { service, notificaciones, manager } = setup();
    notificaciones.cuentaActivada.mockRejectedValue(new Error('violación de CHECK'));

    await expect(service.avisarAlTitular(manager as unknown as EntityManager, USER_ID)).resolves.toBeUndefined();

    expect(manager.query.mock.calls.map((call) => call[0])).toEqual(['SAVEPOINT aviso_primer_acceso', 'ROLLBACK TO SAVEPOINT aviso_primer_acceso']);
  });
});

describe('PrimerAccesoService.vigilarActivacionesPorIp', () => {
  let context: ReturnType<typeof setup>;
  beforeEach(() => { context = setup(); });

  it('cuenta la activación por IP en una ventana de una hora', async () => {
    await context.service.vigilarActivacionesPorIp(IP);

    expect(context.limiter.hit).toHaveBeenCalledWith(`first-access-ip:${IP}`, 3600);
  });

  it('no alerta por debajo del umbral', async () => {
    context.limiter.hit.mockResolvedValue(2);

    await context.service.vigilarActivacionesPorIp(IP);

    expect(context.limiter.rememberOnce).not.toHaveBeenCalled();
    expect(context.auditoria.registrarEventoSeguridad).not.toHaveBeenCalled();
    expect(context.notificaciones.activacionesMasivas).not.toHaveBeenCalled();
  });

  it('al llegar a 3 registra un único evento y avisa a los ADMIN, sin credenciales', async () => {
    context.limiter.hit.mockResolvedValue(3);

    await context.service.vigilarActivacionesPorIp(IP);

    expect(context.limiter.rememberOnce).toHaveBeenCalledWith(`first-access-ip-alert:${IP}`, 3600);
    expect(context.auditoria.registrarEventoSeguridad).toHaveBeenCalledWith(context.manager, 'PRIMER_ACCESO_MASIVO', { usuarioId: null, ip: IP, detalles: { ip: IP, activaciones: 3 } });
    expect(context.notificaciones.activacionesMasivas).toHaveBeenCalledWith(context.manager, { ip: IP, activaciones: 3 });
  });

  it('no repite la alerta dentro de la misma hora aunque el contador siga subiendo', async () => {
    context.limiter.hit.mockResolvedValue(5);
    context.limiter.rememberOnce.mockResolvedValue(false);

    await context.service.vigilarActivacionesPorIp(IP);

    expect(context.dataSource.transaction).not.toHaveBeenCalled();
    expect(context.auditoria.registrarEventoSeguridad).not.toHaveBeenCalled();
  });

  it('si Redis falla no lanza', async () => {
    context.limiter.hit.mockRejectedValue(new Error('Redis caído'));

    await expect(context.service.vigilarActivacionesPorIp(IP)).resolves.toBeUndefined();
    expect(context.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('si el registro de la alerta falla no lanza y libera la marca para reintentar', async () => {
    context.limiter.hit.mockResolvedValue(3);
    context.auditoria.registrarEventoSeguridad.mockRejectedValue(new Error('base caída'));

    await expect(context.service.vigilarActivacionesPorIp(IP)).resolves.toBeUndefined();

    expect(context.limiter.reset).toHaveBeenCalledWith(`first-access-ip-alert:${IP}`);
  });
});
