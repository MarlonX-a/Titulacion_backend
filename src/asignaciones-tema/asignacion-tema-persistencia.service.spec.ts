import { describe, expect, it, vi } from 'vitest';
import { NotificacionTipo } from '../notificaciones/enums/notificacion-canal.enum.js';
import { Postulacion } from '../postulaciones/entities/postulacion.entity.js';
import { EstadoPostulacion } from '../postulaciones/enums/estado-postulacion.enum.js';
import { TemaHistorial } from '../temas/entities/tema-historial.entity.js';
import { Tema } from '../temas/entities/tema.entity.js';
import { EstadoTema } from '../temas/enums/estado-tema.enum.js';
import { AsignacionTemaPersistenciaService } from './asignacion-tema-persistencia.service.js';
import { AsignacionTema } from './entities/asignacion-tema.entity.js';
import { AsignacionTemaCausa } from './enums/asignacion-tema-causa.enum.js';
import { AsignacionTemaEstado } from './enums/asignacion-tema-estado.enum.js';

function setup() {
  const actor = { id: 'admin-id' };
  const assignment = {
    id: 'asignacion-id', periodo_id: 'periodo-id', tema_id: 'tema-id', postulacion_id: 'postulacion-id',
    estado: AsignacionTemaEstado.VIGENTE, causa_anulacion: null as AsignacionTemaCausa | null, motivo_anulacion: null as string | null,
    anulada_por_id: null as string | null, anulada_por: null as unknown, fecha_anulacion: null as Date | null,
  };
  const application = { id: 'postulacion-id', estado: EstadoPostulacion.ACEPTADA, observacion: 'Asignación aprobada' };
  const topic = {
    id: 'tema-id', periodo: { id: 'periodo-id' }, linea: { id: 'linea-id' }, docente_proponente: { id: 'docente-id' },
    titulo: 'Tema', estado: EstadoTema.ASIGNADO, min_integrantes: 1, max_integrantes: 3,
  };
  const repos = {
    assignment: { findOneByOrFail: vi.fn(async () => assignment), save: vi.fn(async (value: unknown) => value) },
    application: { findOneByOrFail: vi.fn(async () => application), save: vi.fn(async (value: unknown) => value) },
    topic: { findOneOrFail: vi.fn(async () => topic), save: vi.fn(async (value: unknown) => value) },
    history: { create: vi.fn((value: unknown) => value), save: vi.fn(async (value: unknown) => value) },
  };
  const query = vi.fn(async (_sql: string, _params?: unknown[]) => [{ id: 'asignacion-id', estado: AsignacionTemaEstado.VIGENTE }]);
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
  const service = new AsignacionTemaPersistenciaService(auditoria as never, tutores as never, notificaciones as never);
  return { service, actor, assignment, application, topic, repos, query, manager, auditoria, tutores, notificaciones };
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
    expect(state.repos.history.save).toHaveBeenCalledWith(expect.objectContaining({ estado_anterior: EstadoTema.ASIGNADO, estado_nuevo: EstadoTema.PUBLICADO }));
    const acciones = state.auditoria.registrar.mock.calls.map((call) => ((call as unknown[])[1] as { accion: string }).accion);
    expect(acciones).toEqual(['ANULAR_ASIGNACION_TEMA', 'ANULAR_POSTULACION_MANUAL', 'REPUBLICAR_TEMA_ANULACION']);
    expect(state.notificaciones.asignacionTema).toHaveBeenCalledWith(state.manager, 'asignacion-id', NotificacionTipo.TEMA_ANULADO, 'admin-id');
  });

  it('la anulación por incumplimiento reutiliza el mismo flujo con su causa y acciones', async () => {
    const state = setup();
    state.query.mockResolvedValueOnce([{ id: 'asignacion-id' }] as never);
    await state.service.anularPorIncumplimiento(state.manager as never, 'periodo-id', 'estudiante-id', state.actor as never, 'No admitido', null);
    expect(state.query.mock.calls[0]?.[0]).toContain('FOR UPDATE OF t,p,a');
    expect(state.assignment.causa_anulacion).toBe(AsignacionTemaCausa.INCUMPLIMIENTO_CONDICION);
    const acciones = state.auditoria.registrar.mock.calls.map((call) => ((call as unknown[])[1] as { accion: string }).accion);
    expect(acciones).toEqual(['ANULAR_ASIGNACION_TEMA', 'ANULAR_POSTULACION_INCUMPLIMIENTO', 'REPUBLICAR_TEMA_INCUMPLIMIENTO']);
  });

  it('bloquea tema, postulación y asignación del período y devuelve su estado', async () => {
    const state = setup();
    await expect(state.service.bloquearParaAnulacion(state.manager as never, 'periodo-id', 'asignacion-id')).resolves.toBe(AsignacionTemaEstado.VIGENTE);
    expect(state.query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE OF t,p,a'), ['asignacion-id', 'periodo-id']);
    state.query.mockResolvedValueOnce([] as never);
    await expect(state.service.bloquearParaAnulacion(state.manager as never, 'periodo-id', 'otra')).resolves.toBeNull();
  });
});
