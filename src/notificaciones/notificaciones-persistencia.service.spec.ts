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

describe('NotificacionesPersistenciaService.cuentaActivada', () => {
  it('avisa al titular en app y por correo con texto neutro, sin datos sensibles', async () => {
    const state = setup();
    await state.service.cuentaActivada(state.manager as never, 'titular-id');
    expect(state.inserts).toHaveLength(2);
    expect(state.inserts.map((params) => params[6])).toEqual(['EN_APP', 'EMAIL']);
    for (const params of state.inserts) {
      expect(params[0]).toBe('titular-id');
      expect(params[1]).toBe('CUENTA_ACTIVADA');
      expect(params[4]).toBe('usuario');
      expect(`${String(params[2])} ${String(params[3])}`).toMatch(/activada.*administraci/i);
      expect(`${String(params[2])} ${String(params[3])}`).not.toMatch(/\d+\.\d+\.\d+|token|código|contraseña temporal/i);
    }
    expect(state.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO "titulacion_dev"."entrega_correo_notificacion"'), ['notificacion-2']);
  });

  it('cada activación usa una entidad nueva para no perder una reactivación posterior', async () => {
    const state = setup();
    await state.service.cuentaActivada(state.manager as never, 'titular-id');
    await state.service.cuentaActivada(state.manager as never, 'titular-id');
    const entidades = new Set(state.inserts.map((params) => params[5]));
    expect(entidades.size).toBe(2);
  });
});

describe('NotificacionesPersistenciaService.activacionesMasivas', () => {
  const admins = [{ usuario_id: 'admin-1' }, { usuario_id: 'admin-2' }, { usuario_id: 'admin-1' }];
  function withAdmins() {
    const inserts: unknown[][] = [];
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes(`u."rol"='ADMIN' AND u."estado"='ACTIVO'`)) return admins;
      if (sql.includes('INSERT INTO "titulacion_dev"."notificacion"')) { inserts.push(params); return [{ id: `notificacion-${inserts.length}` }]; }
      return [];
    });
    const manager = { connection: { options: { schema: 'titulacion_dev' } }, query };
    return { service: new NotificacionesPersistenciaService({ options: {} } as never), manager, query, inserts };
  }

  it('crea solo el aviso en app para cada ADMIN activo, sin correo, con la IP y el conteo', async () => {
    const state = withAdmins();
    const avisados = await state.service.activacionesMasivas(state.manager as never, { ip: '203.0.113.7', activaciones: 3 });
    expect(avisados).toBe(2);
    expect(state.inserts.map((params) => [params[0], params[1], params[4], params[6]])).toEqual([
      ['admin-1', 'ACTIVACIONES_MASIVAS', 'seguridad', 'EN_APP'],
      ['admin-2', 'ACTIVACIONES_MASIVAS', 'seguridad', 'EN_APP'],
    ]);
    expect(String(state.inserts[0]![3])).toContain('3 cuentas');
    expect(String(state.inserts[0]![3])).toContain('203.0.113.7');
    expect(state.query).not.toHaveBeenCalledWith(expect.stringContaining('entrega_correo_notificacion'), expect.anything());
  });

  it('la entidad es la misma para una IP y hora (dedupe en PostgreSQL) y cambia con la IP', async () => {
    const state = withAdmins();
    await state.service.activacionesMasivas(state.manager as never, { ip: '203.0.113.7', activaciones: 3 });
    await state.service.activacionesMasivas(state.manager as never, { ip: '203.0.113.7', activaciones: 4 });
    await state.service.activacionesMasivas(state.manager as never, { ip: '203.0.113.8', activaciones: 3 });
    const [primero, , repetido, , otraIp] = state.inserts.map((params) => params[5]);
    expect(primero).toBe(repetido);
    expect(primero).not.toBe(otraIp);
    expect(primero).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

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
