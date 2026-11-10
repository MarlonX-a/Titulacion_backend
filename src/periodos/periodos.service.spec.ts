import { BadRequestException, ConflictException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PeriodosService } from './periodos.service.js';
import { PeriodoEstado } from './enums/periodo-estado.enum.js';
import { AcademicoService } from '../academico/academico.service.js';
import { construirCatalogo } from '../academico/catalogo-academico.js';

const NOW = new Date('2026-05-10T12:00:00Z');

const CATALOGO = construirCatalogo(
  [{ id: 'fac-1', codigo: 'FAC_1', nombre: 'Facultad Uno' }, { id: 'fac-2', codigo: 'FAC_2', nombre: 'Facultad Dos' }],
  [],
);

function setup(estado: PeriodoEstado, fechas: { inicio: string; fin: string } = { inicio: '2026-05-01T00:00:00Z', fin: '2026-05-20T00:00:00Z' }, ocupados = 0) {
  const periodo = {
    id: 'periodo-id', codigo: '2026-1', nombre: 'Período de prueba',
    fecha_inicio_postulacion: new Date(fechas.inicio),
    fecha_fin_postulacion: new Date(fechas.fin),
    fecha_inicio_titulacion: new Date('2026-06-01T00:00:00Z'),
    max_integrantes_default: 3, estado, facultad_id: 'fac-1',
  };
  const txRepo = {
    findOne: vi.fn(async () => periodo),
    save: vi.fn(async (value: typeof periodo) => ({ ...value })),
  };
  const manager = { getRepository: () => txRepo, query: vi.fn(async () => [{ total: ocupados }]) };
  const dataSource = {
    options: { schema: 'titulacion_dev' },
    transaction: vi.fn(async (callback: (tx: typeof manager) => Promise<unknown>) => callback(manager)),
  };
  const repository = {
    find: vi.fn(async () => [] as Array<{ id: string }>),
    create: vi.fn((value: object) => value),
    save: vi.fn(async (value: object) => ({ id: 'nuevo-id', estado: PeriodoEstado.BORRADOR, ...value })),
  };
  const auditoria = { registrar: vi.fn(async () => undefined) };
  const academico = new AcademicoService();
  vi.spyOn(academico, 'catalogo').mockResolvedValue(CATALOGO);
  const service = new PeriodosService(repository as never, dataSource as never, auditoria as never, academico);
  return { service, periodo, txRepo, repository, auditoria, dataSource, manager };
}

describe('PeriodosService transiciones de postulación', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it('abre automáticamente un BORRADOR dentro del plazo con bloqueo y auditoría sin actor', async () => {
    const state = setup(PeriodoEstado.BORRADOR);
    await expect(state.service.abrirPostulacionAutomatica('periodo-id')).resolves.toBe(true);
    expect(state.txRepo.findOne).toHaveBeenCalledWith({ where: { id: 'periodo-id' }, lock: { mode: 'pessimistic_write' } });
    expect(state.txRepo.save).toHaveBeenCalledWith(expect.objectContaining({ estado: PeriodoEstado.POSTULACION_ABIERTA }));
    expect(state.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), {
      actor: null,
      accion: 'ABRIR_POSTULACION',
      entidad_tipo: 'periodo_titulacion',
      entidad_id: 'periodo-id',
      valores_anteriores: { estado: PeriodoEstado.BORRADOR },
      valores_nuevos: { estado: PeriodoEstado.POSTULACION_ABIERTA, automatico: true },
      ip_origen: null,
    });
  });

  it.each([
    ['ya abierto', PeriodoEstado.POSTULACION_ABIERTA, undefined],
    ['cerrado (no reabre)', PeriodoEstado.POSTULACION_CERRADA, undefined],
    ['archivado', PeriodoEstado.ARCHIVADO, undefined],
    ['antes del inicio', PeriodoEstado.BORRADOR, { inicio: '2026-05-11T00:00:00Z', fin: '2026-05-20T00:00:00Z' }],
    ['con el plazo vencido', PeriodoEstado.BORRADOR, { inicio: '2026-05-01T00:00:00Z', fin: NOW.toISOString() }],
  ])('no abre automáticamente un período %s', async (_caso, estado, fechas) => {
    const state = setup(estado, fechas);
    await expect(state.service.abrirPostulacionAutomatica('periodo-id')).resolves.toBe(false);
    expect(state.txRepo.save).not.toHaveBeenCalled();
    expect(state.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('cierra automáticamente una postulación abierta al vencer exactamente la fecha fin', async () => {
    const state = setup(PeriodoEstado.POSTULACION_ABIERTA, { inicio: '2026-05-01T00:00:00Z', fin: NOW.toISOString() });
    await expect(state.service.cerrarPostulacionAutomatica('periodo-id')).resolves.toBe(true);
    expect(state.txRepo.save).toHaveBeenCalledWith(expect.objectContaining({ estado: PeriodoEstado.POSTULACION_CERRADA }));
    expect(state.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actor: null,
      accion: 'CERRAR_POSTULACION',
      valores_anteriores: { estado: PeriodoEstado.POSTULACION_ABIERTA },
      valores_nuevos: { estado: PeriodoEstado.POSTULACION_CERRADA, automatico: true },
    }));
  });

  it('no cierra automáticamente si el plazo sigue vigente o el estado cambió bajo bloqueo', async () => {
    const vigente = setup(PeriodoEstado.POSTULACION_ABIERTA);
    await expect(vigente.service.cerrarPostulacionAutomatica('periodo-id')).resolves.toBe(false);
    const yaCerrado = setup(PeriodoEstado.POSTULACION_CERRADA, { inicio: '2026-05-01T00:00:00Z', fin: '2026-05-02T00:00:00Z' });
    await expect(yaCerrado.service.cerrarPostulacionAutomatica('periodo-id')).resolves.toBe(false);
    const inexistente = setup(PeriodoEstado.POSTULACION_ABIERTA);
    inexistente.txRepo.findOne.mockResolvedValueOnce(null as never);
    await expect(inexistente.service.cerrarPostulacionAutomatica('periodo-id')).resolves.toBe(false);
    for (const state of [vigente, yaCerrado, inexistente]) expect(state.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('el cierre manual conserva el actor, la IP y no marca la acción como automática', async () => {
    const state = setup(PeriodoEstado.POSTULACION_ABIERTA, { inicio: '2026-05-01T00:00:00Z', fin: '2026-05-02T00:00:00Z' });
    const actor = { id: 'admin-id' };
    const result = await state.service.cerrarPostulacion('periodo-id', {} as never, actor as never, '10.0.0.1');
    expect(result.estado).toBe(PeriodoEstado.POSTULACION_CERRADA);
    expect(state.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actor, ip_origen: '10.0.0.1', valores_nuevos: { estado: PeriodoEstado.POSTULACION_CERRADA },
    }));
  });

  it('la reapertura manual desde CERRADA sigue auditándose como REABRIR_POSTULACION', async () => {
    const state = setup(PeriodoEstado.POSTULACION_CERRADA);
    const actor = { id: 'admin-id' };
    await state.service.abrirPostulacion('periodo-id', {} as never, actor as never, null);
    expect(state.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actor, accion: 'REABRIR_POSTULACION', valores_anteriores: { estado: PeriodoEstado.POSTULACION_CERRADA },
    }));
  });

  it('la apertura manual fuera de plazo sigue respondiendo 409', async () => {
    const state = setup(PeriodoEstado.BORRADOR, { inicio: '2026-05-11T00:00:00Z', fin: '2026-05-20T00:00:00Z' });
    await expect(state.service.abrirPostulacion('periodo-id', {} as never, { id: 'admin-id' } as never, null)).rejects.toBeInstanceOf(ConflictException);
    expect(state.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('preselecciona candidatos por estado y fechas', async () => {
    const state = setup(PeriodoEstado.BORRADOR);
    state.repository.find.mockResolvedValueOnce([{ id: 'abrir-1' }]).mockResolvedValueOnce([{ id: 'cerrar-1' }]);
    await expect(state.service.candidatosTransicionAutomatica(NOW)).resolves.toEqual({ aperturas: ['abrir-1'], cierres: ['cerrar-1'] });
    const [aperturas, cierres] = state.repository.find.mock.calls as unknown as Array<[{ where: Record<string, unknown> }]>;
    expect(aperturas[0].where.estado).toBe(PeriodoEstado.BORRADOR);
    expect(cierres[0].where.estado).toBe(PeriodoEstado.POSTULACION_ABIERTA);
  });
});

describe('PeriodosService facultad', () => {
  const dto = {
    codigo: '2027-1', nombre: 'Período', facultad_id: 'fac-2', max_integrantes_default: 3,
    fecha_inicio_postulacion: '2027-01-01T08:00:00-05:00', fecha_fin_postulacion: '2027-01-20T08:00:00-05:00', fecha_inicio_titulacion: '2027-02-01T08:00:00-05:00',
  };

  it('crea el período con su facultad y la expone en la respuesta', async () => {
    const state = setup(PeriodoEstado.BORRADOR);
    const created = await state.service.create(dto as never);
    expect(state.repository.create).toHaveBeenCalledWith(expect.objectContaining({ facultad_id: 'fac-2' }));
    expect(created).toMatchObject({ facultad_id: 'fac-2', facultad: { id: 'fac-2', nombre: 'Facultad Dos' } });
  });

  it('rechaza una facultad inexistente con 400 sin guardar', async () => {
    const state = setup(PeriodoEstado.BORRADOR);
    await expect(state.service.create({ ...dto, facultad_id: 'otra' } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(state.repository.save).not.toHaveBeenCalled();
  });

  it('cambia la facultad de un BORRADOR sin temas ni habilitaciones', async () => {
    const state = setup(PeriodoEstado.BORRADOR);
    const result = await state.service.update('periodo-id', { facultad_id: 'fac-2' } as never);
    expect(state.txRepo.save).toHaveBeenCalledWith(expect.objectContaining({ facultad_id: 'fac-2' }));
    expect(result.facultad).toEqual({ id: 'fac-2', nombre: 'Facultad Dos' });
  });

  it('impide cambiar la facultad si el período ya tiene habilitaciones', async () => {
    const state = setup(PeriodoEstado.BORRADOR, undefined, 2);
    await expect(state.service.update('periodo-id', { facultad_id: 'fac-2' } as never)).rejects.toThrow('No se puede cambiar la facultad: el período ya tiene estudiantes habilitados.');
    expect(state.txRepo.save).not.toHaveBeenCalled();
  });

  it('en POSTULACION_CERRADA acepta repetir la facultad y rechaza cambiarla', async () => {
    const cerrado = setup(PeriodoEstado.POSTULACION_CERRADA);
    await expect(cerrado.service.update('periodo-id', { facultad_id: 'fac-1', fecha_fin_postulacion: '2026-05-25T00:00:00Z' } as never)).resolves.toMatchObject({ facultad_id: 'fac-1' });
    await expect(setup(PeriodoEstado.POSTULACION_CERRADA).service.update('periodo-id', { facultad_id: 'fac-2' } as never)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza editar la facultad en POSTULACION_ABIERTA', async () => {
    const state = setup(PeriodoEstado.POSTULACION_ABIERTA);
    await expect(state.service.update('periodo-id', { facultad_id: 'fac-2' } as never)).rejects.toBeInstanceOf(ConflictException);
  });
});
