import { describe, expect, it, vi } from 'vitest';
import { NotificacionesPersistenciaService } from './notificaciones-persistencia.service.js';

function setup(activo = true) {
  const inserts: unknown[][] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM "titulacion_dev"."estudiante_habilitado"')) {
      return [{ usuario_id: 'estudiante-usuario-id', situacion_ingreso: 'NO_ADMITIDO', periodo: '2026-1' }];
    }
    if (sql.includes('INSERT INTO "titulacion_dev"."notificacion"')) {
      if (!activo) return [];
      inserts.push(params);
      return [{ id: `notificacion-${inserts.length}` }];
    }
    return [];
  });
  const manager = { connection: { options: { schema: 'titulacion_dev' } }, query };
  const service = new NotificacionesPersistenciaService({ options: {} } as never);
  return { service, manager, query, inserts };
}

describe('NotificacionesPersistenciaService.ingreso', () => {
  it('explica la suspensión automática al iniciar la titulación en app y correo asíncrono', async () => {
    const state = setup();
    await state.service.ingreso(state.manager as never, 'habilitado-id', 'admin-id', 'SUSPENSION_INICIO');
    expect(state.inserts).toHaveLength(2);
    for (const params of state.inserts) {
      expect(params[1]).toBe('INGRESO_RESUELTO');
      expect(params[2]).toBe('Habilitación suspendida');
      expect(params[3]).toContain('requisito pendiente no se resolvió antes del inicio de titulación');
      expect(params[4]).toBe('estudiante_habilitado');
      expect(params[5]).toBe('habilitado-id');
    }
    expect(state.inserts.map((params) => params[6])).toEqual(['EN_APP', 'EMAIL']);
    expect(state.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "titulacion_dev"."entrega_correo_notificacion"'),
      ['notificacion-2'],
    );
  });

  it('conserva el mensaje de resolución manual por defecto', async () => {
    const state = setup();
    await state.service.ingreso(state.manager as never, 'habilitado-id', 'admin-id');
    expect(state.inserts[0]?.[2]).toBe('Situación de ingreso actualizada');
    expect(state.inserts[0]?.[3]).toContain('quedó no_admitido');
  });

  it('no falla cuando la cuenta del estudiante está inactiva: la inserción omite al destinatario', async () => {
    const state = setup(false);
    await expect(state.service.ingreso(state.manager as never, 'habilitado-id', 'admin-id', 'SUSPENSION_INICIO')).resolves.toBeUndefined();
    const [selectSql] = state.query.mock.calls[0] as [string];
    expect(selectSql).not.toContain(`u."estado"='ACTIVO'`);
    expect(state.inserts).toHaveLength(0);
  });
});
