import { describe, expect, it, vi } from 'vitest';
import { NotificacionTipo } from '../notificaciones/enums/notificacion-canal.enum.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { TemaHistorial } from '../temas/entities/tema-historial.entity.js';
import { Tema } from '../temas/entities/tema.entity.js';
import { EstadoTema } from '../temas/enums/estado-tema.enum.js';
import { Postulacion } from './entities/postulacion.entity.js';
import { EstadoPostulacion } from './enums/estado-postulacion.enum.js';
import { MOTIVO_VENCIDA_CIERRE, MOTIVO_VENCIDA_PLAZO, RESERVA_CONFIRMACION_HORAS, limiteVigencia, motivoReservaVencida, venceEn } from './reserva-tema.js';
import { MOTIVO_ARCHIVO, ReservaTemaService, SISTEMA_RESERVA } from './reserva-tema.service.js';

const HORA = 3_600_000;
const NOW = new Date('2026-05-10T12:00:00Z');

describe('reglas de vencimiento de la reserva', () => {
  const abierto = { estado: PeriodoEstado.POSTULACION_ABIERTA, fecha_fin_postulacion: new Date('2026-05-20T00:00:00Z') };

  it('vence a las 48 horas exactas del registro', () => {
    expect(RESERVA_CONFIRMACION_HORAS).toBe(48);
    const fecha = new Date(NOW.getTime() - 48 * HORA);
    expect(venceEn(fecha)).toEqual(NOW);
    expect(motivoReservaVencida(fecha, abierto, NOW)).toBe(MOTIVO_VENCIDA_PLAZO);
    expect(motivoReservaVencida(new Date(fecha.getTime() + 1), abierto, NOW)).toBeNull();
    expect(limiteVigencia(NOW)).toEqual(fecha);
  });

  it('vence cuando el período deja de estar abierto o termina su plazo', () => {
    const reciente = new Date(NOW.getTime() - HORA);
    expect(motivoReservaVencida(reciente, { ...abierto, estado: PeriodoEstado.POSTULACION_CERRADA }, NOW)).toBe(MOTIVO_VENCIDA_CIERRE);
    expect(motivoReservaVencida(reciente, { ...abierto, fecha_fin_postulacion: NOW }, NOW)).toBe(MOTIVO_VENCIDA_CIERRE);
  });
});

interface Estado { temaEstado: EstadoTema; activas: number; postulacion?: { estado: string; fecha: Date; periodoEstado: PeriodoEstado } }

function setup(estado: Estado) {
  const calls: string[] = [];
  const query = vi.fn(async (sql: string, _params?: unknown[]): Promise<unknown[]> => {
    if (sql.includes('SELECT "estado"::text AS estado FROM "titulacion_dev"."tema"')) { calls.push('lock-tema'); return [{ estado: estado.temaEstado }]; }
    if (sql.includes('count(*)::int AS total')) return [{ total: estado.activas }];
    if (sql.includes('SELECT "periodo_id","tema_id"')) return estado.postulacion ? [{ periodo_id: 'periodo-id', tema_id: 'tema-id' }] : [];
    if (sql.includes('"periodo_titulacion" WHERE "id"=$1 FOR UPDATE')) { calls.push('lock-periodo'); return [{ estado: estado.postulacion?.periodoEstado, fecha_fin_postulacion: '2026-05-20T00:00:00Z' }]; }
    if (sql.includes('SELECT 1 FROM "titulacion_dev"."tema"')) { calls.push('lock-tema'); return []; }
    if (sql.includes('"fecha_postulacion","observacion"')) { calls.push('lock-postulacion'); return [{ estado: estado.postulacion?.estado, fecha_postulacion: estado.postulacion?.fecha, observacion: null }]; }
    if (sql.includes('"estado"::text = ANY($2::text[]) ORDER BY "id"') && !sql.includes('FOR UPDATE')) return [{ id: 'p1', tema_id: 'tema-id' }, { id: 'p2', tema_id: 'tema-id' }];
    if (sql.includes('"tema" WHERE "id" = ANY')) { calls.push('lock-temas'); return []; }
    if (sql.includes('"observacion" FROM "titulacion_dev"."postulacion" WHERE "id" = ANY')) { calls.push('lock-postulaciones'); return [{ id: 'p1', tema_id: 'tema-id', observacion: null }, { id: 'p2', tema_id: 'tema-id', observacion: null }]; }
    if (sql.includes('SELECT "estado"::text AS estado FROM "titulacion_dev"."postulacion"')) return [{ estado: EstadoPostulacion.PENDIENTE }];
    return [];
  });
  const temaRepo = { update: vi.fn(async (_w: unknown, values: { estado: EstadoTema }) => { calls.push(`tema:${values.estado}`); estado.temaEstado = values.estado; }) };
  const postulacionRepo = { update: vi.fn(async ({ id }: { id: string }, values: { estado: string }) => { calls.push(`postulacion:${id}:${values.estado}`); }) };
  const historialRepo = { create: vi.fn((value: object) => value), save: vi.fn(async (value: object) => { calls.push('historial'); return value; }) };
  const repos = new Map<unknown, unknown>([[Tema, temaRepo], [Postulacion, postulacionRepo], [TemaHistorial, historialRepo]]);
  const manager = { connection: { options: { schema: 'titulacion_dev' } }, query, getRepository: (entity: unknown) => repos.get(entity) };
  const dataSource = { manager, query, transaction: vi.fn(async (cb: (m: typeof manager) => Promise<unknown>) => cb(manager)) };
  const auditoria = { registrar: vi.fn(async (_m: unknown, entry: { accion: string }) => { calls.push(`audit:${entry.accion}`); }) };
  const notificaciones = { postulacion: vi.fn(async () => undefined) };
  const service = new ReservaTemaService(dataSource as never, auditoria as never, notificaciones as never);
  return { service, manager, calls, auditoria, historialRepo, notificaciones, query };
}

describe('ReservaTemaService', () => {
  it('reserva un tema con historial y auditoría', async () => {
    const state = setup({ temaEstado: EstadoTema.PUBLICADO, activas: 0 });
    await state.service.reservar(state.manager as never, 'tema-id', 'post-id', { id: 'rep' } as never, null);
    expect(state.calls).toEqual([`tema:${EstadoTema.RESERVADO}`, 'historial', 'audit:RESERVAR_TEMA']);
  });

  it('no libera el tema mientras otra postulación activa lo retiene', async () => {
    const state = setup({ temaEstado: EstadoTema.RESERVADO, activas: 1 });
    await expect(state.service.liberarSiCorresponde(state.manager as never, 'tema-id', SISTEMA_RESERVA, 'x')).resolves.toBe(false);
    expect(state.calls).toEqual(['lock-tema']);
  });

  it('no toca un tema que no está RESERVADO (p. ej. ya CERRADO)', async () => {
    const state = setup({ temaEstado: EstadoTema.CERRADO, activas: 0 });
    await expect(state.service.liberarSiCorresponde(state.manager as never, 'tema-id', SISTEMA_RESERVA, 'x')).resolves.toBe(false);
  });

  it('libera automáticamente con historial sin usuario marcado como automático', async () => {
    const state = setup({ temaEstado: EstadoTema.RESERVADO, activas: 0 });
    await expect(state.service.liberarSiCorresponde(state.manager as never, 'tema-id', SISTEMA_RESERVA, 'Reserva vencida')).resolves.toBe(true);
    expect(state.historialRepo.create).toHaveBeenCalledWith(expect.objectContaining({ usuario: null, estado_anterior: EstadoTema.RESERVADO, estado_nuevo: EstadoTema.PUBLICADO, cambios: { motivo: 'Reserva vencida', automatico: true } }));
    expect(state.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actor: null, accion: 'LIBERAR_TEMA_RESERVA', valores_nuevos: { estado: EstadoTema.PUBLICADO, motivo: 'Reserva vencida', automatico: true } }));
  });

  it('vence bajo bloqueo (período → tema → postulación) una reserva de más de 48 horas', async () => {
    const state = setup({ temaEstado: EstadoTema.RESERVADO, activas: 0, postulacion: { estado: EstadoPostulacion.PENDIENTE_CONFIRMACION, fecha: new Date(NOW.getTime() - 49 * HORA), periodoEstado: PeriodoEstado.POSTULACION_ABIERTA } });
    await expect(state.service.expirarSiVencida(state.manager as never, 'post-id', SISTEMA_RESERVA, NOW)).resolves.toBe(MOTIVO_VENCIDA_PLAZO);
    expect(state.calls.slice(0, 4)).toEqual(['lock-periodo', 'lock-tema', 'lock-postulacion', `postulacion:post-id:${EstadoPostulacion.CANCELADA}`]);
    expect(state.calls).toContain('audit:EXPIRAR_RESERVA_POSTULACION');
    expect(state.calls).toContain(`tema:${EstadoTema.PUBLICADO}`);
    expect(state.notificaciones.postulacion).toHaveBeenCalledWith(expect.anything(), 'post-id', NotificacionTipo.POSTULACION_CANCELADA, '');
  });

  it('no vence una reserva vigente ni una postulación que ya salió de PENDIENTE_CONFIRMACION', async () => {
    const vigente = setup({ temaEstado: EstadoTema.RESERVADO, activas: 0, postulacion: { estado: EstadoPostulacion.PENDIENTE_CONFIRMACION, fecha: new Date(NOW.getTime() - HORA), periodoEstado: PeriodoEstado.POSTULACION_ABIERTA } });
    await expect(vigente.service.expirarSiVencida(vigente.manager as never, 'post-id', SISTEMA_RESERVA, NOW)).resolves.toBeNull();
    const confirmada = setup({ temaEstado: EstadoTema.RESERVADO, activas: 0, postulacion: { estado: EstadoPostulacion.PENDIENTE, fecha: new Date(NOW.getTime() - 72 * HORA), periodoEstado: PeriodoEstado.POSTULACION_ABIERTA } });
    await expect(confirmada.service.expirarSiVencida(confirmada.manager as never, 'post-id', SISTEMA_RESERVA, NOW)).resolves.toBeNull();
    for (const state of [vigente, confirmada]) expect(state.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('el barrido periódico procesa cada candidata en su propia transacción', async () => {
    const state = setup({ temaEstado: EstadoTema.RESERVADO, activas: 0, postulacion: { estado: EstadoPostulacion.PENDIENTE_CONFIRMACION, fecha: new Date(NOW.getTime() - 49 * HORA), periodoEstado: PeriodoEstado.POSTULACION_ABIERTA } });
    state.query.mockImplementationOnce(async () => [{ id: 'post-1' }, { id: 'post-2' }]);
    await expect(state.service.expirarVencidas(NOW)).resolves.toEqual({ expiradas: 2, fallidas: 0 });
    const [sql, params] = state.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain(`p."estado"='PENDIENTE_CONFIRMACION'`);
    expect(params).toEqual([limiteVigencia(NOW), NOW]);
  });

  it('al archivar cancela las reservas del período (bloqueando temas antes que postulaciones) y libera los temas', async () => {
    const state = setup({ temaEstado: EstadoTema.RESERVADO, activas: 0 });
    await expect(state.service.cancelarPorArchivo(state.manager as never, 'periodo-id', { id: 'admin' } as never, '10.0.0.1')).resolves.toBe(2);
    expect(state.calls.slice(0, 3)).toEqual(['lock-temas', 'lock-postulaciones', `postulacion:p1:${EstadoPostulacion.CANCELADA}`]);
    expect(state.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'CANCELAR_POSTULACION_POR_ARCHIVO', valores_nuevos: { estado: EstadoPostulacion.CANCELADA, observacion: MOTIVO_ARCHIVO } }));
  });
});
