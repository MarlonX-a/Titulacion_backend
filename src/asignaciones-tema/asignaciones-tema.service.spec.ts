import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { AsignacionesTemaService } from './asignaciones-tema.service.js';
import { AsignacionTemaCausa } from './enums/asignacion-tema-causa.enum.js';
import { AsignacionTemaEstado } from './enums/asignacion-tema-estado.enum.js';
import { ResolucionConflicto } from '../conflictos/entities/resolucion-conflicto.entity.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { Postulacion } from '../postulaciones/entities/postulacion.entity.js';
import { EstadoPostulacion } from '../postulaciones/enums/estado-postulacion.enum.js';
import { TemaHistorial } from '../temas/entities/tema-historial.entity.js';
import { Tema } from '../temas/entities/tema.entity.js';
import { EstadoTema } from '../temas/enums/estado-tema.enum.js';
import { TipoTema } from '../temas/enums/tipo-tema.enum.js';
import { AsignacionTema } from './entities/asignacion-tema.entity.js';

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

describe('AsignacionesTemaService.assign', () => {
  it('rejects the topic open applications of other periods inside the same assignment transaction', async () => {
    const actor = { id: 'admin-id' };
    const topic = { id: 'tema-id', carrera_id: 'car', linea: { id: 'linea-id' }, docente_proponente: { id: 'docente-id' }, tipo: TipoTema.INDIVIDUAL, titulo: 'Tema', descripcion: 'D', estado: EstadoTema.PUBLICADO, creado_en: new Date() };
    const app = { id: 'post-id', estado: EstadoPostulacion.PENDIENTE, observacion: null as string | null, tema: topic, grupo: null, estudiante: { id: 'est-id' } };
    const save = vi.fn(async (value: unknown) => value);
    const repos = new Map<unknown, unknown>([
      [PeriodoTitulacion, { findOne: vi.fn(async () => ({ id: 'periodo-a', estado: PeriodoEstado.POSTULACION_CERRADA, fecha_inicio_titulacion: new Date() })) }],
      [Postulacion, { findOne: vi.fn(async () => app), find: vi.fn(async () => [app]), save }],
      [Tema, { findOne: vi.fn(async () => topic), save }],
      [AsignacionTema, { exist: vi.fn(async () => false), create: vi.fn((value: object) => value), save: vi.fn(async (value: object) => ({ id: 'asignacion-id', ...value })) }],
      [ResolucionConflicto, { findOne: vi.fn(async () => null) }],
      [TemaHistorial, { create: vi.fn((value: unknown) => value), save }],
    ]);
    const manager = { connection: { options: { schema: 'titulacion_dev' } }, query: vi.fn(async () => [{ id: 'post-id' }]), getRepository: (entity: unknown) => repos.get(entity) };
    const order: string[] = [];
    const dataSource = { transaction: vi.fn(async (_isolation: string, callback: (value: typeof manager) => Promise<unknown>) => { const result = await callback(manager); order.push('commit'); return result; }) };
    const persistencia = {
      tieneVigenteParaEstudiante: vi.fn(async () => false),
      rechazarAbiertasDeOtrosPeriodos: vi.fn(async () => { order.push('cross-period'); }),
    };
    const auditoria = { registrar: vi.fn(async () => undefined) };
    const notificaciones = { asignacionTema: vi.fn(async () => undefined), postulacion: vi.fn(async () => undefined) };
    const service = new AsignacionesTemaService({} as never, {} as never, dataSource as never, {} as never, auditoria as never, persistencia as never, notificaciones as never);
    const internals = service as unknown as Record<'validateApplication' | 'isCandidateEligible', (...args: unknown[]) => Promise<unknown>>;
    vi.spyOn(internals, 'validateApplication').mockResolvedValue(['est-id']);
    vi.spyOn(internals, 'isCandidateEligible').mockResolvedValue(true);
    vi.spyOn(service, 'getById').mockResolvedValue({ id: 'asignacion-id' } as never);

    await service.assign('periodo-a', 'post-id', { motivo: ' Acta 7 ' }, actor as never, '10.0.0.1');

    expect(persistencia.rechazarAbiertasDeOtrosPeriodos).toHaveBeenCalledWith(manager, 'tema-id', 'periodo-a', ' Acta 7 ', actor, '10.0.0.1');
    expect(order).toEqual(['cross-period', 'commit']);
  });
});
