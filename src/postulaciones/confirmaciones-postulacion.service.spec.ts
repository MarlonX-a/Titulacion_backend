import { ConflictException, NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { NotificacionTipo } from '../notificaciones/enums/notificacion-canal.enum.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { EstadoTema } from '../temas/enums/estado-tema.enum.js';
import { TipoTema } from '../temas/enums/tipo-tema.enum.js';
import { ConfirmacionesPostulacionService } from './confirmaciones-postulacion.service.js';
import { PostulacionConfirmacion } from './entities/postulacion-confirmacion.entity.js';
import { Postulacion } from './entities/postulacion.entity.js';
import { EstadoConfirmacion } from './enums/estado-confirmacion.enum.js';
import { EstadoPostulacion } from './enums/estado-postulacion.enum.js';
import { MOTIVO_VENCIDA_PLAZO } from './reserva-tema.js';

const NOW = new Date('2026-05-10T12:00:00Z');
const HORA = 3_600_000;

interface Opciones {
  estado?: EstadoPostulacion;
  horas?: number;
  filas?: Array<{ estudiante: string; estado: EstadoConfirmacion }>;
  actorEstudiante?: string | null;
  periodoEstado?: PeriodoEstado;
}

function setup(opciones: Opciones = {}) {
  const calls: string[] = [];
  const periodo = { id: 'periodo-id', estado: opciones.periodoEstado ?? PeriodoEstado.POSTULACION_ABIERTA, fecha_fin_postulacion: new Date('2026-05-20T00:00:00Z') };
  const postulacion = {
    id: 'post-id', estado: opciones.estado ?? EstadoPostulacion.PENDIENTE_CONFIRMACION, observacion: null as string | null,
    fecha_postulacion: new Date(NOW.getTime() - (opciones.horas ?? 1) * HORA),
    periodo, tema: { id: 'tema-id', titulo: 'Tema', tipo: TipoTema.GRUPO, estado: EstadoTema.RESERVADO },
    grupo: { id: 'grupo-id', nombre: 'Grupo A' }, registrada_por: { id: 'rep-user', nombres: 'Ana', apellidos: 'Rep' },
  };
  const filas = (opciones.filas ?? [
    { estudiante: 'est-rep', estado: EstadoConfirmacion.CONFIRMADA },
    { estudiante: 'est-b', estado: EstadoConfirmacion.PENDIENTE },
    { estudiante: 'est-c', estado: EstadoConfirmacion.PENDIENTE },
  ]).map((fila, index) => ({
    id: `conf-${index}`, postulacion_id: 'post-id', estudiante_id: fila.estudiante, estado: fila.estado, motivo: null as string | null,
    respondida_en: fila.estado === EstadoConfirmacion.PENDIENTE ? null : new Date(NOW.getTime() - HORA), creado_en: new Date(index),
    estudiante: { usuario: { nombres: fila.estudiante, apellidos: 'X' } },
  }));
  const actorEstudiante = opciones.actorEstudiante === undefined ? 'est-b' : opciones.actorEstudiante;
  const repos = new Map<unknown, unknown>([
    [Estudiante, { findOne: vi.fn(async () => (actorEstudiante ? { id: actorEstudiante } : null)) }],
    [PeriodoTitulacion, { findOne: vi.fn(async () => { calls.push('lock-periodo'); return periodo; }) }],
    [Postulacion, {
      findOneOrFail: vi.fn(async () => ({ ...postulacion })),
      find: vi.fn(async () => [postulacion]),
      update: vi.fn(async (_where: unknown, values: Partial<typeof postulacion>) => { calls.push(`postulacion:${values.estado}`); Object.assign(postulacion, values); }),
    }],
    [PostulacionConfirmacion, {
      find: vi.fn(async () => filas.map((fila) => ({ ...fila }))),
      update: vi.fn(async ({ id }: { id: string }, values: Partial<(typeof filas)[number]>) => { calls.push(`confirmacion:${id}:${values.estado}`); Object.assign(filas.find((fila) => fila.id === id)!, values); }),
    }],
  ]);
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('EXISTS (SELECT 1 FROM "titulacion_dev"."postulacion_confirmacion" c')) {
      return filas.some((fila) => fila.estudiante_id === actorEstudiante) ? [{ periodo_id: 'periodo-id', tema_id: 'tema-id', grupo_id: 'grupo-id' }] : [];
    }
    if (sql.includes('FOR UPDATE')) calls.push(`lock:${sql.match(/"titulacion_dev"\."(\w+)"/)?.[1]}`);
    return [];
  });
  const manager = { connection: { options: { schema: 'titulacion_dev' } }, query, getRepository: (entity: unknown) => repos.get(entity) };
  const dataSource = { manager, query, transaction: vi.fn(async (cb: (m: typeof manager) => Promise<unknown>) => cb(manager)) };
  const auditoria = { registrar: vi.fn(async (_m: unknown, entry: { accion: string }) => { calls.push(`audit:${entry.accion}`); }) };
  const notificaciones = { postulacion: vi.fn(async () => undefined) };
  const reservas = {
    expirar: vi.fn(async () => { calls.push('expirar'); }),
    liberarSiCorresponde: vi.fn(async () => { calls.push('liberar'); return true; }),
  };
  const service = new ConfirmacionesPostulacionService(dataSource as never, auditoria as never, notificaciones as never, reservas as never);
  return { service, calls, postulacion, filas, auditoria, notificaciones, reservas };
}

const actor = { id: 'user-b', nombres: 'Beto', apellidos: 'B' };

describe('ConfirmacionesPostulacionService', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it('confirma la fila del integrante bajo bloqueo y deja la postulación esperando a los demás', async () => {
    const state = setup();
    const result = await state.service.confirmar('post-id', actor as never, '10.0.0.1');
    expect(state.calls.slice(0, 5)).toEqual(['lock-periodo', 'lock:tema', 'lock:grupo', 'lock:postulacion', 'lock:postulacion_confirmacion']);
    expect(state.calls).toContain(`confirmacion:conf-1:${EstadoConfirmacion.CONFIRMADA}`);
    expect(state.calls).not.toContain(`postulacion:${EstadoPostulacion.PENDIENTE}`);
    expect(result.estado_postulacion).toBe(EstadoPostulacion.PENDIENTE_CONFIRMACION);
    expect(result.mi_confirmacion.estado).toBe(EstadoConfirmacion.CONFIRMADA);
    expect(result.vence_en).toEqual(new Date(NOW.getTime() - HORA + 48 * HORA));
  });

  it('cuando confirma el último integrante la postulación pasa a PENDIENTE y se notifica', async () => {
    const state = setup({ filas: [{ estudiante: 'est-rep', estado: EstadoConfirmacion.CONFIRMADA }, { estudiante: 'est-b', estado: EstadoConfirmacion.PENDIENTE }] });
    const result = await state.service.confirmar('post-id', actor as never, null);
    expect(state.calls).toContain(`postulacion:${EstadoPostulacion.PENDIENTE}`);
    expect(state.calls).toContain('audit:CONFIRMAR_POSTULACION_COMPLETA');
    expect(state.notificaciones.postulacion).toHaveBeenCalledWith(expect.anything(), 'post-id', NotificacionTipo.POSTULACION_REGISTRADA, 'user-b');
    expect(state.reservas.liberarSiCorresponde).not.toHaveBeenCalled();
    expect(result.estado_postulacion).toBe(EstadoPostulacion.PENDIENTE);
  });

  it('confirmar dos veces es idempotente', async () => {
    const state = setup({ filas: [{ estudiante: 'est-rep', estado: EstadoConfirmacion.CONFIRMADA }, { estudiante: 'est-b', estado: EstadoConfirmacion.CONFIRMADA }], estado: EstadoPostulacion.PENDIENTE });
    const result = await state.service.confirmar('post-id', actor as never, null);
    expect(result.mi_confirmacion.estado).toBe(EstadoConfirmacion.CONFIRMADA);
    expect(state.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('rechazar deja la postulación RECHAZADA con el motivo y libera el tema', async () => {
    const state = setup();
    const result = await state.service.rechazar('post-id', actor as never, '  No estoy de acuerdo  ', null);
    expect(state.calls).toContain(`confirmacion:conf-1:${EstadoConfirmacion.RECHAZADA}`);
    expect(state.calls).toContain(`postulacion:${EstadoPostulacion.RECHAZADA}`);
    expect(state.postulacion.observacion).toBe('Rechazada por un integrante del grupo (Beto B): No estoy de acuerdo');
    expect(state.filas[1]!.motivo).toBe('No estoy de acuerdo');
    expect(state.notificaciones.postulacion).toHaveBeenCalledWith(expect.anything(), 'post-id', NotificacionTipo.POSTULACION_RECHAZADA, 'user-b');
    expect(state.reservas.liberarSiCorresponde).toHaveBeenCalledWith(expect.anything(), 'tema-id', { actor, ip: null }, state.postulacion.observacion);
    expect(result.estado_postulacion).toBe(EstadoPostulacion.RECHAZADA);
  });

  it('rechazar de nuevo es idempotente, pero no se puede rechazar después de confirmar', async () => {
    const repetido = setup({ estado: EstadoPostulacion.RECHAZADA, filas: [{ estudiante: 'est-rep', estado: EstadoConfirmacion.CONFIRMADA }, { estudiante: 'est-b', estado: EstadoConfirmacion.RECHAZADA }] });
    await expect(repetido.service.rechazar('post-id', actor as never, undefined, null)).resolves.toMatchObject({ mi_confirmacion: { estado: EstadoConfirmacion.RECHAZADA } });
    expect(repetido.auditoria.registrar).not.toHaveBeenCalled();
    const confirmado = setup({ filas: [{ estudiante: 'est-rep', estado: EstadoConfirmacion.CONFIRMADA }, { estudiante: 'est-b', estado: EstadoConfirmacion.CONFIRMADA }, { estudiante: 'est-c', estado: EstadoConfirmacion.PENDIENTE }] });
    await expect(confirmado.service.rechazar('post-id', actor as never, undefined, null)).rejects.toThrow('Ya confirmaste esta postulación');
  });

  it('responde 409 si la postulación ya no espera confirmaciones', async () => {
    const state = setup({ estado: EstadoPostulacion.CANCELADA });
    await expect(state.service.confirmar('post-id', actor as never, null)).rejects.toThrow('La postulación ya no espera confirmaciones (estado: CANCELADA).');
  });

  it('vence la reserva de más de 48 horas, la confirma en la base y responde 409', async () => {
    const state = setup({ horas: 49 });
    await expect(state.service.confirmar('post-id', actor as never, null)).rejects.toThrow(`La reserva venció: ${MOTIVO_VENCIDA_PLAZO}`);
    expect(state.reservas.expirar).toHaveBeenCalledWith(expect.anything(), { id: 'post-id', tema_id: 'tema-id', observacion: null }, MOTIVO_VENCIDA_PLAZO, { actor: null, ip: null });
    expect(state.calls).not.toContain(`confirmacion:conf-1:${EstadoConfirmacion.CONFIRMADA}`);
  });

  it('vence la reserva cuando el período ya cerró la postulación', async () => {
    const state = setup({ periodoEstado: PeriodoEstado.POSTULACION_CERRADA });
    await expect(state.service.rechazar('post-id', actor as never, undefined, null)).rejects.toBeInstanceOf(ConflictException);
    expect(state.reservas.expirar).toHaveBeenCalled();
  });

  it('oculta la postulación a quien no participa en ella', async () => {
    const ajeno = setup({ actorEstudiante: 'est-z' });
    await expect(ajeno.service.confirmar('post-id', actor as never, null)).rejects.toBeInstanceOf(NotFoundException);
    const sinPerfil = setup({ actorEstudiante: null });
    await expect(sinPerfil.service.confirmar('post-id', actor as never, null)).rejects.toBeInstanceOf(NotFoundException);
    expect(ajeno.auditoria.registrar).not.toHaveBeenCalled();
  });
});
