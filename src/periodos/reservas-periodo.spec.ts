import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AcademicoService } from '../academico/academico.service.js';
import { construirCatalogo } from '../academico/catalogo-academico.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { ArchivoPeriodoService } from './archivo-periodo.service.js';
import { PeriodoEstado } from './enums/periodo-estado.enum.js';
import { PeriodosService } from './periodos.service.js';
import { TransicionesPeriodoService } from './transiciones-periodo.service.js';

/** Integración de los flujos de período con las reservas de temas (bloque 3). */
const NOW = new Date('2026-05-10T12:00:00Z');

function periodo(estado: PeriodoEstado) {
  return {
    id: 'periodo-id', codigo: 'P', nombre: 'P', estado, facultad_id: 'fac', max_integrantes_default: 3,
    fecha_inicio_postulacion: new Date('2026-05-01T00:00:00Z'), fecha_fin_postulacion: new Date('2026-05-09T00:00:00Z'), fecha_inicio_titulacion: new Date('2026-06-01T00:00:00Z'),
  };
}

describe('Reservas de temas en los flujos de período', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it('el cierre (manual o automático) vence las reservas sin confirmar dentro de su transacción', async () => {
    const calls: string[] = [];
    const actual = periodo(PeriodoEstado.POSTULACION_ABIERTA);
    const repo = { findOne: vi.fn(async () => actual), save: vi.fn(async (value: object) => { calls.push('save-periodo'); return { ...value }; }) };
    const manager = { getRepository: () => repo, query: vi.fn(async () => []) };
    const dataSource = { options: { schema: 'titulacion_dev' }, transaction: vi.fn(async (cb: (m: typeof manager) => Promise<unknown>) => cb(manager)) };
    const reservas = { expirarPorCierre: vi.fn(async () => { calls.push('expirar-reservas'); return 1; }) };
    const academico = new AcademicoService();
    vi.spyOn(academico, 'catalogo').mockResolvedValue(construirCatalogo([], []));
    const service = new PeriodosService({} as never, dataSource as never, { registrar: vi.fn(async () => { calls.push('audit'); }) } as never, academico, reservas as never);

    await service.cerrarPostulacion('periodo-id', {}, { id: 'admin-id' } as never, null);
    expect(calls).toEqual(['save-periodo', 'audit', 'expirar-reservas']);
    expect(reservas.expirarPorCierre).toHaveBeenCalledWith(manager, 'periodo-id', { actor: { id: 'admin-id' }, ip: null });

    actual.estado = PeriodoEstado.POSTULACION_ABIERTA;
    await service.cerrarPostulacionAutomatica('periodo-id');
    expect(reservas.expirarPorCierre).toHaveBeenLastCalledWith(manager, 'periodo-id', { actor: null, ip: null });
  });

  it('el archivo cancela las reservas del período antes de archivarlo', async () => {
    const calls: string[] = [];
    const actor = { id: 'admin-id', rol: UsuarioRol.ADMIN, estado: UsuarioEstado.ACTIVO };
    const periodRepo = { findOne: vi.fn(async () => periodo(PeriodoEstado.EN_CURSO)), save: vi.fn(async (value: { estado: PeriodoEstado }) => { calls.push(`save:${value.estado}`); return value; }) };
    const manager = { getRepository: (entity: unknown) => (entity === Usuario ? { findOne: vi.fn(async () => actor) } : periodRepo) };
    const dataSource = { transaction: vi.fn(async (_level: string, cb: (m: typeof manager) => Promise<unknown>) => cb(manager)) };
    const reservas = { cancelarPorArchivo: vi.fn(async () => { calls.push('cancelar-reservas'); return 2; }) };
    const service = new ArchivoPeriodoService(dataSource as never, { registrar: vi.fn() } as never, { catalogo: async () => construirCatalogo([], []) } as never, reservas as never);
    await service.archivar('periodo-id', { motivo: 'Cierre administrativo' }, actor as never, '10.0.0.1');
    expect(calls).toEqual(['cancelar-reservas', `save:${PeriodoEstado.ARCHIVADO}`]);
    expect(reservas.cancelarPorArchivo).toHaveBeenCalledWith(manager, 'periodo-id', actor, '10.0.0.1');
  });

  it('el scheduler vence reservas después de las transiciones y un fallo no detiene el job', async () => {
    const periodos = { candidatosTransicionAutomatica: vi.fn(async () => ({ aperturas: [], cierres: ['c-1'] })), cerrarPostulacionAutomatica: vi.fn(async () => true), abrirPostulacionAutomatica: vi.fn() };
    const config = { get: vi.fn(() => false) };
    const reservas = { expirarVencidas: vi.fn(async () => ({ expiradas: 3, fallidas: 1 })) };
    const service = new TransicionesPeriodoService(periodos as never, {} as never, config as never, reservas as never);
    await expect(service.ejecutar(NOW)).resolves.toEqual({ abiertos: 0, cerrados: 1, fallidos: 1, reservasVencidas: 3 });
    expect(reservas.expirarVencidas).toHaveBeenCalledWith(NOW);

    reservas.expirarVencidas.mockRejectedValueOnce(new Error('redis caído'));
    await expect(service.ejecutar(NOW)).resolves.toEqual({ abiertos: 0, cerrados: 1, fallidos: 1, reservasVencidas: 0 });
  });
});
