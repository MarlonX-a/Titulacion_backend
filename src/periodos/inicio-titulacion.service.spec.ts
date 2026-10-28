import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HabilitadoEstado } from '../habilitados/enums/habilitado-estado.enum.js';
import { SituacionIngreso } from '../habilitados/enums/situacion-ingreso.enum.js';
import { PeriodoEstado } from './enums/periodo-estado.enum.js';
import { InicioTitulacionService } from './inicio-titulacion.service.js';

function setup(estado = PeriodoEstado.POSTULACION_CERRADA, pending: Array<{ id: string; estado: string; estudiante_id: string }> = []) {
  const calls: string[] = [];
  const periodo = {
    id: 'periodo-id',
    codigo: 'P-1',
    nombre: 'Período',
    estado,
    fecha_inicio_postulacion: new Date('2026-01-01T00:00:00Z'),
    fecha_fin_postulacion: new Date('2026-01-02T00:00:00Z'),
    fecha_inicio_titulacion: new Date(Date.now() - 1_000),
    max_integrantes_default: 3,
  };
  const repository = {
    findOne: vi.fn(async () => { calls.push('lock-periodo'); return periodo; }),
    save: vi.fn(async (value: typeof periodo) => { calls.push(`save-periodo:${value.estado}`); return value; }),
  };
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.trimStart().startsWith('SELECT')) { calls.push('select-pendientes'); return pending; }
    calls.push('update-pendientes');
    return [];
  });
  const manager = { connection: { options: { schema: 'titulacion_dev' } }, getRepository: () => repository, query };
  const dataSource = { transaction: vi.fn(async (_level: string, callback: (m: typeof manager) => Promise<unknown>) => callback(manager)) };
  const auditoria = { registrar: vi.fn(async (_manager: unknown, entry: { accion: string }) => { calls.push(`audit:${entry.accion}`); }) };
  const habilitados = { aplicarNoAdmision: vi.fn(async (_manager: unknown, habilitacion: { id: string }) => { calls.push(`no-admision:${habilitacion.id}`); }) };
  const service = new InicioTitulacionService(dataSource as never, auditoria as never, habilitados as never);
  return { service, calls, query, auditoria, dataSource, habilitados, repository };
}

describe('InicioTitulacionService.iniciar', () => {
  it('suspende a los condicionados pendientes antes de pasar el período a EN_CURSO', async () => {
    const state = setup(PeriodoEstado.POSTULACION_CERRADA, [
      { id: '00000000-0000-4000-8000-000000000001', estado: HabilitadoEstado.HABILITADO, estudiante_id: 'estudiante-1' },
      { id: '00000000-0000-4000-8000-000000000002', estado: HabilitadoEstado.HABILITADO, estudiante_id: 'estudiante-2' },
    ]);
    const result = await state.service.iniciar('periodo-id', { id: 'admin-id' } as never, '127.0.0.1');

    expect(result.estado).toBe(PeriodoEstado.EN_CURSO);
    expect(state.dataSource.transaction).toHaveBeenCalledWith('SERIALIZABLE', expect.any(Function));
    expect(state.calls).toEqual([
      'lock-periodo',
      'select-pendientes',
      'update-pendientes',
      'audit:SUSPENDER_HABILITACION_INICIO',
      'no-admision:00000000-0000-4000-8000-000000000001',
      'audit:SUSPENDER_HABILITACION_INICIO',
      'no-admision:00000000-0000-4000-8000-000000000002',
      `save-periodo:${PeriodoEstado.EN_CURSO}`,
      'audit:INICIAR_TITULACION',
    ]);
    const [selectSql] = state.query.mock.calls[0] as [string];
    expect(selectSql).toContain('"titulacion_dev"."estudiante_habilitado"');
    expect(selectSql).toMatch(/ORDER BY "id" ASC\s+FOR UPDATE/);
    expect(selectSql).toContain('"estudiante_id"');
    const [updateSql, params] = state.query.mock.calls[1] as [string, unknown[]];
    expect(updateSql).toContain(`"estado" = '${HabilitadoEstado.SUSPENDIDO}'`);
    expect(updateSql).toContain(`"situacion_ingreso" = '${SituacionIngreso.NO_ADMITIDO}'`);
    expect(params).toEqual([
      ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'],
      expect.any(Date),
      'admin-id',
      'Requisito no resuelto antes del inicio de titulación.',
      'periodo-id',
    ]);
    expect(state.auditoria.registrar).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      accion: 'INICIAR_TITULACION',
      valores_nuevos: expect.objectContaining({ estado: PeriodoEstado.EN_CURSO, condicionados_suspendidos: 2 }),
    }));
  });

  it('aplica a cada suspendido los efectos de una NO_ADMISIÓN manual con el aviso de suspensión', async () => {
    const state = setup(PeriodoEstado.POSTULACION_CERRADA, [
      { id: '00000000-0000-4000-8000-000000000001', estado: HabilitadoEstado.HABILITADO, estudiante_id: 'estudiante-1' },
    ]);
    const actor = { id: 'admin-id' };
    await state.service.iniciar('periodo-id', actor as never, '10.0.0.1');
    expect(state.habilitados.aplicarNoAdmision).toHaveBeenCalledTimes(1);
    expect(state.habilitados.aplicarNoAdmision).toHaveBeenCalledWith(
      expect.objectContaining({ query: state.query }),
      { id: '00000000-0000-4000-8000-000000000001', periodoId: 'periodo-id', estudianteId: 'estudiante-1' },
      actor,
      '10.0.0.1',
      'Requisito no resuelto antes del inicio de titulación.',
      'SUSPENSION_INICIO',
    );
  });

  it('no pasa el período a EN_CURSO si fallan los efectos de la NO_ADMISIÓN', async () => {
    const state = setup(PeriodoEstado.POSTULACION_CERRADA, [
      { id: '00000000-0000-4000-8000-000000000001', estado: HabilitadoEstado.HABILITADO, estudiante_id: 'estudiante-1' },
    ]);
    state.habilitados.aplicarNoAdmision.mockRejectedValueOnce(new Error('fallo al anular'));
    await expect(state.service.iniciar('periodo-id', { id: 'admin-id' } as never, null))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(state.repository.save).not.toHaveBeenCalled();
    expect(state.calls).not.toContain('audit:INICIAR_TITULACION');
  });

  it('inicia sin actualizar habilitaciones cuando no hay pendientes', async () => {
    const state = setup();
    await state.service.iniciar('periodo-id', { id: 'admin-id' } as never, null);
    expect(state.calls).not.toContain('update-pendientes');
    expect(state.habilitados.aplicarNoAdmision).not.toHaveBeenCalled();
    expect(state.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      valores_nuevos: expect.objectContaining({ condicionados_suspendidos: 0 }),
    }));
  });

  it('sigue rechazando estados distintos de POSTULACION_CERRADA', async () => {
    const state = setup(PeriodoEstado.POSTULACION_ABIERTA);
    await expect(state.service.iniciar('periodo-id', { id: 'admin-id' } as never, null)).rejects.toBeInstanceOf(ConflictException);
    expect(state.query).not.toHaveBeenCalled();
  });
});
