import { describe, expect, it, vi } from 'vitest';
import { NotificacionTipo } from '../notificaciones/enums/notificacion-canal.enum.js';
import { Postulacion } from '../postulaciones/entities/postulacion.entity.js';
import { EstadoPostulacion } from '../postulaciones/enums/estado-postulacion.enum.js';
import { TemaHistorial } from '../temas/entities/tema-historial.entity.js';
import { Tema } from '../temas/entities/tema.entity.js';
import { EstadoTema } from '../temas/enums/estado-tema.enum.js';
import { TipoTema } from '../temas/enums/tipo-tema.enum.js';
import { AsignacionTemaPersistenciaService } from './asignacion-tema-persistencia.service.js';
import { AsignacionTema } from './entities/asignacion-tema.entity.js';
import { AsignacionTemaCausa } from './enums/asignacion-tema-causa.enum.js';
import { AsignacionTemaEstado } from './enums/asignacion-tema-estado.enum.js';
import { AsignacionTemaOrigen } from './enums/asignacion-tema-origen.enum.js';

function setup() {
  const actor = { id: 'admin-id' };
  const assignment = {
    id: 'asignacion-id', periodo_id: 'periodo-id', tema_id: 'tema-id', postulacion_id: 'postulacion-id' as string | null,
    origen: AsignacionTemaOrigen.POSTULACION, grupo_id: null as string | null,
    estado: AsignacionTemaEstado.VIGENTE, causa_anulacion: null as AsignacionTemaCausa | null, motivo_anulacion: null as string | null,
    anulada_por_id: null as string | null, anulada_por: null as unknown, fecha_anulacion: null as Date | null,
  };
  const application = { id: 'postulacion-id', estado: EstadoPostulacion.ACEPTADA, observacion: 'Asignación aprobada' };
  const topic = {
    id: 'tema-id', linea: { id: 'linea-id' }, docente_proponente: { id: 'docente-id' },
    titulo: 'Tema', estado: EstadoTema.ASIGNADO, tipo: TipoTema.GRUPO,
  };
  const repos = {
    assignment: { findOneByOrFail: vi.fn(async () => assignment), save: vi.fn(async (value: unknown) => value) },
    application: { findOneByOrFail: vi.fn(async () => application), save: vi.fn(async (value: unknown) => value) },
    topic: { findOneOrFail: vi.fn(async () => topic), save: vi.fn(async (value: unknown) => value) },
    history: { create: vi.fn((value: unknown) => value), save: vi.fn(async (value: unknown) => value) },
  };
  // Responde según la sentencia: existencia, candidatas, referencias, bloqueos de tema/postulación y de la asignación.
  const query = vi.fn(async (sql: string, params?: unknown[]): Promise<unknown[]> => {
    if (sql.startsWith('SELECT 1 FROM "titulacion_dev"."asignacion_tema"')) return params?.[0] === 'asignacion-id' ? [{ '?column?': 1 }] : [];
    if (sql.includes('a."tema_id",a."postulacion_id"')) return [{ id: 'asignacion-id', tema_id: 'tema-id', postulacion_id: assignment.postulacion_id }];
    if (sql.includes('"estado"::text AS estado')) return [{ id: 'asignacion-id', estado: AsignacionTemaEstado.VIGENTE }];
    if (sql.includes('FOR UPDATE')) return [];
    return [{ id: 'asignacion-id' }];
  });
  const manager = {
    connection: { options: { schema: 'titulacion_dev' } },
    query,
    getRepository: (entity: unknown) => {
      if (entity === AsignacionTema) return repos.assignment;
      if (entity === Postulacion) return repos.application;
      if (entity === Tema) return repos.topic;
      if (entity === TemaHistorial) return repos.history;
      throw new Error('Repositorio no configurado.');
    },
  };
  const auditoria = { registrar: vi.fn(async () => undefined) };
  const tutores = { anularPorAsignacionTema: vi.fn(async () => undefined) };
  const notificaciones = { asignacionTema: vi.fn(async () => undefined) };
  const grupos = { disolverEquipoAdministrativo: vi.fn(async () => undefined) };
  const service = new AsignacionTemaPersistenciaService(auditoria as never, tutores as never, notificaciones as never, grupos as never);
  return { service, actor, assignment, application, topic, repos, query, manager, auditoria, tutores, notificaciones, grupos };
}

/** Tablas bloqueadas con FOR UPDATE, en el orden en que se emitieron las sentencias. */
function ordenBloqueos(calls: unknown[][]): string[] {
  return calls.map((call) => String(call[0])).filter((sql) => sql.includes('FOR UPDATE'))
    .map((sql) => /FROM "titulacion_dev"\."(\w+)"/.exec(sql)?.[1] ?? '?');
}

describe('AsignacionTemaPersistenciaService', () => {
  it('anula con la causa indicada, termina al tutor, anula la postulación y republica el tema', async () => {
    const state = setup();
    await state.service.anularBloqueada(state.manager as never, 'asignacion-id', {
      causa: AsignacionTemaCausa.OTRA, motivo: '  Desistimiento del grupo  ',
      accionPostulacion: 'ANULAR_POSTULACION_MANUAL', accionTema: 'REPUBLICAR_TEMA_ANULACION',
    }, state.actor as never, '127.0.0.1');

    expect(state.assignment).toMatchObject({ estado: AsignacionTemaEstado.ANULADA, causa_anulacion: AsignacionTemaCausa.OTRA, motivo_anulacion: 'Desistimiento del grupo', anulada_por_id: 'admin-id' });
    expect(state.assignment.fecha_anulacion).toBeInstanceOf(Date);
    expect(state.tutores.anularPorAsignacionTema).toHaveBeenCalledWith(state.manager, 'periodo-id', 'asignacion-id', 'Desistimiento del grupo', state.actor, '127.0.0.1');
    expect(state.application).toMatchObject({ estado: EstadoPostulacion.ANULADA, observacion: 'Desistimiento del grupo' });
    expect(state.topic.estado).toBe(EstadoTema.PUBLICADO);
    const historial = JSON.stringify(state.repos.history.save.mock.calls[0]![0]);
    expect(historial).toContain('"tipo":"GRUPO"');
    expect(historial).not.toContain('"periodo_id"');
    expect(state.repos.history.save).toHaveBeenCalledWith(expect.objectContaining({ estado_anterior: EstadoTema.ASIGNADO, estado_nuevo: EstadoTema.PUBLICADO }));
    const acciones = state.auditoria.registrar.mock.calls.map((call) => ((call as unknown[])[1] as { accion: string }).accion);
    expect(acciones).toEqual(['ANULAR_ASIGNACION_TEMA', 'ANULAR_POSTULACION_MANUAL', 'REPUBLICAR_TEMA_ANULACION']);
    expect(state.notificaciones.asignacionTema).toHaveBeenCalledWith(state.manager, 'asignacion-id', NotificacionTipo.TEMA_ANULADO, 'admin-id');
    expect(state.grupos.disolverEquipoAdministrativo).not.toHaveBeenCalled();
  });

  it('la anulación por incumplimiento reutiliza el mismo flujo con su causa y acciones', async () => {
    const state = setup();
    await state.service.anularPorIncumplimiento(state.manager as never, 'periodo-id', 'estudiante-id', state.actor as never, 'No admitido', null);
    expect(ordenBloqueos(state.query.mock.calls)).toEqual(['tema', 'postulacion', 'asignacion_tema']);
    expect(state.assignment.causa_anulacion).toBe(AsignacionTemaCausa.INCUMPLIMIENTO_CONDICION);
    const acciones = state.auditoria.registrar.mock.calls.map((call) => ((call as unknown[])[1] as { accion: string }).accion);
    expect(acciones).toEqual(['ANULAR_ASIGNACION_TEMA', 'ANULAR_POSTULACION_INCUMPLIMIENTO', 'REPUBLICAR_TEMA_INCUMPLIMIENTO']);
  });

  it('bloquea tema, postulación y asignación del período y devuelve su estado', async () => {
    const state = setup();
    await expect(state.service.bloquearParaAnulacion(state.manager as never, 'periodo-id', 'asignacion-id')).resolves.toBe(AsignacionTemaEstado.VIGENTE);
    expect(state.query.mock.calls[0]).toEqual([expect.stringContaining('"periodo_id"=$2'), ['asignacion-id', 'periodo-id']]);
    expect(ordenBloqueos(state.query.mock.calls)).toEqual(['tema', 'postulacion', 'asignacion_tema']);
    await expect(state.service.bloquearParaAnulacion(state.manager as never, 'periodo-id', 'otra')).resolves.toBeNull();
  });

  it('una asignación administrativa (sin postulación) se bloquea y anula sin tocar postulaciones', async () => {
    const state = setup();
    state.assignment.postulacion_id = null;
    state.assignment.origen = AsignacionTemaOrigen.ADMIN;
    await expect(state.service.bloquearParaAnulacion(state.manager as never, 'periodo-id', 'asignacion-id')).resolves.toBe(AsignacionTemaEstado.VIGENTE);
    expect(ordenBloqueos(state.query.mock.calls)).toEqual(['tema', 'asignacion_tema']);
    await state.service.anularBloqueada(state.manager as never, 'asignacion-id', {
      causa: AsignacionTemaCausa.OTRA, motivo: 'Equipo reorganizado',
      accionPostulacion: 'ANULAR_POSTULACION_MANUAL', accionTema: 'REPUBLICAR_TEMA_ANULACION',
    }, state.actor as never, null);
    expect(state.repos.application.findOneByOrFail).not.toHaveBeenCalled();
    expect(state.repos.application.save).not.toHaveBeenCalled();
    expect(state.assignment.estado).toBe(AsignacionTemaEstado.ANULADA);
    expect(state.topic.estado).toBe(EstadoTema.PUBLICADO);
    const acciones = state.auditoria.registrar.mock.calls.map((call) => ((call as unknown[])[1] as { accion: string }).accion);
    expect(acciones).toEqual(['ANULAR_ASIGNACION_TEMA', 'REPUBLICAR_TEMA_ANULACION']);
    expect(state.grupos.disolverEquipoAdministrativo).not.toHaveBeenCalled();
  });

  it('al anular un equipo administrativo grupal disuelve el grupo después de dejar la asignación ANULADA', async () => {
    const state = setup();
    state.assignment.postulacion_id = null;
    state.assignment.origen = AsignacionTemaOrigen.ADMIN;
    state.assignment.grupo_id = 'grupo-id';
    await state.service.anularBloqueada(state.manager as never, 'asignacion-id', {
      causa: AsignacionTemaCausa.OTRA, motivo: 'Equipo reorganizado',
      accionPostulacion: 'ANULAR_POSTULACION_MANUAL', accionTema: 'REPUBLICAR_TEMA_ANULACION',
    }, state.actor as never, null);
    expect(state.assignment.estado).toBe(AsignacionTemaEstado.ANULADA);
    expect(state.grupos.disolverEquipoAdministrativo).toHaveBeenCalledWith(state.manager, 'grupo-id', state.actor, 'Equipo reorganizado', null);
    expect(state.repos.assignment.save.mock.invocationCallOrder[0]).toBeLessThan(state.grupos.disolverEquipoAdministrativo.mock.invocationCallOrder[0]!);
    expect(state.repos.application.save).not.toHaveBeenCalled();
  });

  it('una postulación grupal anulada no disuelve el grupo', async () => {
    const state = setup();
    state.assignment.grupo_id = 'grupo-postulacion';
    await state.service.anularBloqueada(state.manager as never, 'asignacion-id', {
      causa: AsignacionTemaCausa.OTRA, motivo: 'Desistimiento',
      accionPostulacion: 'ANULAR_POSTULACION_MANUAL', accionTema: 'REPUBLICAR_TEMA_ANULACION',
    }, state.actor as never, null);
    expect(state.application.estado).toBe(EstadoPostulacion.ANULADA);
    expect(state.grupos.disolverEquipoAdministrativo).not.toHaveBeenCalled();
  });
});

describe('AsignacionTemaPersistenciaService.rechazarAbiertasDeOtrosPeriodos', () => {
  function setupCrossPeriod() {
    const actor = { id: 'admin-id' };
    const applications = [
      { id: 'p-other-open', periodo_id: 'periodo-b', estado: EstadoPostulacion.PENDIENTE, observacion: null as string | null, archivado: false },
      { id: 'p-other-conflict', periodo_id: 'periodo-b', estado: EstadoPostulacion.EN_CONFLICTO, observacion: null as string | null, archivado: false },
      { id: 'p-archived', periodo_id: 'periodo-viejo', estado: EstadoPostulacion.PENDIENTE, observacion: null as string | null, archivado: true },
      { id: 'p-same-period', periodo_id: 'periodo-a', estado: EstadoPostulacion.PENDIENTE, observacion: null as string | null, archivado: false },
    ];
    // Emulates the SQL filters: other period, open states, and ARCHIVADO periods excluded.
    const query = vi.fn(async (sql: string, params: [string, string]) => applications
      .filter((item) => item.periodo_id !== params[1] && [EstadoPostulacion.PENDIENTE, EstadoPostulacion.EN_CONFLICTO].includes(item.estado))
      .filter((item) => !(sql.includes(`pe."estado"='ARCHIVADO'`) && item.archivado))
      .map(({ id }) => ({ id })));
    const repo = {
      findOneBy: vi.fn(async ({ id }: { id: string }) => applications.find((item) => item.id === id) ?? null),
      save: vi.fn(async (value: unknown) => value),
    };
    const manager = { connection: { options: { schema: 'titulacion_dev' } }, query, getRepository: () => repo };
    const auditoria = { registrar: vi.fn(async () => undefined) };
    const notificaciones = { postulacion: vi.fn(async () => undefined) };
    const service = new AsignacionTemaPersistenciaService(auditoria as never, {} as never, notificaciones as never, { disolverEquipoAdministrativo: vi.fn() } as never);
    return { service, actor, applications, query, repo, manager, auditoria, notificaciones };
  }

  it('rejects open applications of other open periods, leaves archived ones untouched, and writes audit and notification', async () => {
    const state = setupCrossPeriod();
    await state.service.rechazarAbiertasDeOtrosPeriodos(state.manager as never, 'tema-id', 'periodo-a', '  Resolución 12  ', state.actor as never, '127.0.0.1');

    expect(state.query.mock.calls[0]![0]).toContain('FOR UPDATE OF p');
    expect(state.query.mock.calls[0]![1]).toEqual(['tema-id', 'periodo-a']);
    expect(state.applications.map((item) => [item.id, item.estado])).toEqual([
      ['p-other-open', EstadoPostulacion.RECHAZADA],
      ['p-other-conflict', EstadoPostulacion.RECHAZADA],
      ['p-archived', EstadoPostulacion.PENDIENTE],
      ['p-same-period', EstadoPostulacion.PENDIENTE],
    ]);
    expect(state.applications[0]!.observacion).toBe('Tema asignado en otro período: Resolución 12');
    expect(state.auditoria.registrar).toHaveBeenCalledTimes(2);
    expect(state.auditoria.registrar).toHaveBeenCalledWith(state.manager, expect.objectContaining({
      accion: 'RECHAZAR_POSTULACION_POR_ASIGNACION_TEMA', entidad_tipo: 'postulacion', entidad_id: 'p-other-conflict',
      valores_anteriores: { estado: EstadoPostulacion.EN_CONFLICTO, observacion: null }, ip_origen: '127.0.0.1',
    }));
    expect(state.notificaciones.postulacion).toHaveBeenCalledTimes(2);
    expect(state.notificaciones.postulacion).toHaveBeenCalledWith(state.manager, 'p-other-open', NotificacionTipo.POSTULACION_RECHAZADA, 'admin-id');
  });
});
