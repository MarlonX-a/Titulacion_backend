import { describe, expect, it, vi } from 'vitest';
import { NotificacionTipo } from '../notificaciones/enums/notificacion-canal.enum.js';
import { EstadoPostulacion } from './enums/estado-postulacion.enum.js';
import { PostulacionPersistenciaService } from './postulacion-persistencia.service.js';

function setup(groupRows: Array<{ id: string }>, postulacionRows: Array<{ id: string }>, items: Record<string, { id: string; estado: EstadoPostulacion; observacion: string | null }>) {
  const calls: string[] = [];
  const query = vi.fn(async (sql: string, _params: unknown[]) => {
    if (sql.includes('FOR UPDATE OF g')) { calls.push('lock-grupo'); return groupRows; }
    if (sql.includes('"postulacion" p')) { calls.push('lock-postulaciones'); return postulacionRows; }
    return [];
  });
  const repo = {
    findOneByOrFail: vi.fn(async ({ id }: { id: string }) => items[id]!),
    save: vi.fn(async (value: unknown) => { calls.push('save'); return value; }),
  };
  const manager = { connection: { options: { schema: 'titulacion_dev' } }, query, getRepository: () => repo };
  const auditoria = { registrar: vi.fn(async () => undefined) };
  const notificaciones = { postulacion: vi.fn(async () => undefined) };
  const service = new PostulacionPersistenciaService(auditoria as never, notificaciones as never);
  return { service, manager, query, repo, auditoria, notificaciones, calls };
}

const actor = { id: 'admin-id' };

describe('PostulacionPersistenciaService.cancelar', () => {
  it('pasa la postulación a CANCELADA con el motivo, audita y notifica POSTULACION_CANCELADA', async () => {
    const item = { id: 'p1', estado: EstadoPostulacion.PENDIENTE, observacion: null };
    const state = setup([], [], {});
    await state.service.cancelar(state.manager as never, item as never, actor as never, '  Motivo  ', '10.0.0.1');
    expect(item).toMatchObject({ estado: EstadoPostulacion.CANCELADA, observacion: 'Motivo' });
    expect(state.repo.save).toHaveBeenCalledWith(item);
    expect(state.auditoria.registrar).toHaveBeenCalledWith(state.manager, expect.objectContaining({
      accion: 'CANCELAR_POSTULACION', entidad_tipo: 'postulacion', entidad_id: 'p1',
      valores_anteriores: { estado: EstadoPostulacion.PENDIENTE, observacion: null },
      valores_nuevos: { estado: EstadoPostulacion.CANCELADA, observacion: 'Motivo' }, ip_origen: '10.0.0.1',
    }));
    expect(state.notificaciones.postulacion).toHaveBeenCalledWith(state.manager, 'p1', NotificacionTipo.POSTULACION_CANCELADA, 'admin-id');
  });
});

describe('PostulacionPersistenciaService.cancelarPendientesPorNoAdmision', () => {
  it('bloquea el grupo antes que las postulaciones y cancela solo las PENDIENTE individuales y grupales', async () => {
    const items = {
      individual: { id: 'individual', estado: EstadoPostulacion.PENDIENTE, observacion: null },
      grupal: { id: 'grupal', estado: EstadoPostulacion.PENDIENTE, observacion: null },
      anulada: { id: 'anulada', estado: EstadoPostulacion.ANULADA, observacion: 'Anulada antes' },
    };
    const state = setup([{ id: 'grupo-id' }], [{ id: 'grupal' }, { id: 'individual' }, { id: 'anulada' }], items);
    const result = await state.service.cancelarPendientesPorNoAdmision(state.manager as never, 'periodo-id', 'estudiante-id', actor as never, 'No admitido', null);

    expect(result).toEqual(['grupal', 'individual']);
    expect(state.calls.slice(0, 2)).toEqual(['lock-grupo', 'lock-postulaciones']);
    const [groupSql, groupParams] = state.query.mock.calls[0] as [string, unknown[]];
    expect(groupSql).toContain('"titulacion_dev"."grupo_integrante"');
    expect(groupSql).toContain('"estado"=\'ACTIVO\'');
    expect(groupParams).toEqual(['periodo-id', 'estudiante-id']);
    const [postSql, postParams] = state.query.mock.calls[1] as [string, unknown[]];
    expect(postSql).toContain('"titulacion_dev"."postulacion"');
    expect(postSql).toContain('"estado"=\'PENDIENTE\'');
    expect(postSql).toMatch(/ORDER BY p\."id" FOR UPDATE$/);
    expect(postParams).toEqual(['periodo-id', 'estudiante-id', ['grupo-id']]);
    expect(items.anulada).toMatchObject({ estado: EstadoPostulacion.ANULADA, observacion: 'Anulada antes' });
    expect(state.auditoria.registrar).toHaveBeenCalledTimes(2);
    expect(state.auditoria.registrar).toHaveBeenCalledWith(state.manager, expect.objectContaining({ accion: 'CANCELAR_POSTULACION_NO_ADMISION', entidad_id: 'grupal' }));
    expect(state.notificaciones.postulacion).toHaveBeenCalledTimes(2);
  });

  it('no escribe nada cuando el estudiante no tiene postulaciones pendientes', async () => {
    const state = setup([], [], {});
    await expect(state.service.cancelarPendientesPorNoAdmision(state.manager as never, 'periodo-id', 'estudiante-id', actor as never, 'No admitido', null)).resolves.toEqual([]);
    expect(state.query.mock.calls[1]?.[1]).toEqual(['periodo-id', 'estudiante-id', []]);
    expect(state.repo.save).not.toHaveBeenCalled();
    expect(state.auditoria.registrar).not.toHaveBeenCalled();
  });
});
