import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { AsignacionesTemaService } from './asignaciones-tema.service.js';
import { AsignacionTemaCausa } from './enums/asignacion-tema-causa.enum.js';
import { AsignacionTemaEstado } from './enums/asignacion-tema-estado.enum.js';

function setup(periodoEstado: PeriodoEstado | null = PeriodoEstado.EN_CURSO, asignacionEstado: AsignacionTemaEstado | null = AsignacionTemaEstado.VIGENTE) {
  const actor = { id: 'admin-id' };
  const periodRepo = { findOne: vi.fn(async () => periodoEstado ? { id: 'periodo-id', estado: periodoEstado } : null) };
  const manager = { getRepository: () => periodRepo };
  const dataSource = { transaction: vi.fn(async (_isolation: string, callback: (value: typeof manager) => Promise<unknown>) => callback(manager)) };
  const persistencia = {
    bloquearParaAnulacion: vi.fn(async () => asignacionEstado),
    anularBloqueada: vi.fn(async () => undefined),
  };
  const service = new AsignacionesTemaService({} as never, {} as never, dataSource as never, {} as never, {} as never, persistencia as never, {} as never);
  const getById = vi.spyOn(service, 'getById').mockResolvedValue({ id: 'asignacion-id', estado: AsignacionTemaEstado.ANULADA } as never);
  return { service, actor, periodRepo, dataSource, persistencia, getById };
}

describe('AsignacionesTemaService.anular', () => {
  it('anula una asignación VIGENTE en una transacción serializable con la causa y motivo indicados', async () => {
    const state = setup();
    const result = await state.service.anular('periodo-id', 'asignacion-id', { causa: AsignacionTemaCausa.OTRA, motivo: 'Desistimiento' }, state.actor as never, '127.0.0.1');
    expect(result.estado).toBe(AsignacionTemaEstado.ANULADA);
    expect(state.dataSource.transaction).toHaveBeenCalledWith('SERIALIZABLE', expect.any(Function));
    expect(state.periodRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({ lock: { mode: 'pessimistic_write' } }));
    expect(state.persistencia.anularBloqueada).toHaveBeenCalledWith(expect.anything(), 'asignacion-id', {
      causa: AsignacionTemaCausa.OTRA, motivo: 'Desistimiento',
      accionPostulacion: 'ANULAR_POSTULACION_MANUAL', accionTema: 'REPUBLICAR_TEMA_ANULACION',
    }, state.actor, '127.0.0.1');
  });

  it('usa las acciones de incumplimiento cuando esa es la causa', async () => {
    const state = setup(PeriodoEstado.POSTULACION_CERRADA);
    await state.service.anular('periodo-id', 'asignacion-id', { causa: AsignacionTemaCausa.INCUMPLIMIENTO_CONDICION, motivo: 'Requisito' }, state.actor as never, null);
    expect(state.persistencia.anularBloqueada).toHaveBeenCalledWith(expect.anything(), 'asignacion-id', expect.objectContaining({
      causa: AsignacionTemaCausa.INCUMPLIMIENTO_CONDICION, accionPostulacion: 'ANULAR_POSTULACION_INCUMPLIMIENTO',
    }), state.actor, null);
  });

  it('rechaza períodos ARCHIVADOS y asignaciones que ya no están VIGENTES sin aplicar efectos', async () => {
    const archived = setup(PeriodoEstado.ARCHIVADO);
    await expect(archived.service.anular('periodo-id', 'asignacion-id', { causa: AsignacionTemaCausa.OTRA, motivo: 'X' }, archived.actor as never, null)).rejects.toBeInstanceOf(ConflictException);
    expect(archived.persistencia.bloquearParaAnulacion).not.toHaveBeenCalled();
    const annulled = setup(PeriodoEstado.EN_CURSO, AsignacionTemaEstado.ANULADA);
    await expect(annulled.service.anular('periodo-id', 'asignacion-id', { causa: AsignacionTemaCausa.OTRA, motivo: 'X' }, annulled.actor as never, null)).rejects.toThrow('Solo se pueden anular asignaciones VIGENTES.');
    for (const state of [archived, annulled]) expect(state.persistencia.anularBloqueada).not.toHaveBeenCalled();
  });

  it('responde 404 si el período o la asignación no existen', async () => {
    const noPeriod = setup(null);
    await expect(noPeriod.service.anular('periodo-id', 'asignacion-id', { causa: AsignacionTemaCausa.OTRA, motivo: 'X' }, noPeriod.actor as never, null)).rejects.toBeInstanceOf(NotFoundException);
    const noAssignment = setup(PeriodoEstado.EN_CURSO, null);
    await expect(noAssignment.service.anular('periodo-id', 'asignacion-id', { causa: AsignacionTemaCausa.OTRA, motivo: 'X' }, noAssignment.actor as never, null)).rejects.toBeInstanceOf(NotFoundException);
  });
});
