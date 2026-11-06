import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AcademicoService } from '../academico/academico.service.js';
import { construirCatalogo } from '../academico/catalogo-academico.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { LineaInvestigacion } from '../lineas-investigacion/entities/linea-investigacion.entity.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { AsignacionTema } from '../asignaciones-tema/entities/asignacion-tema.entity.js';
import { NotificacionTipo } from '../notificaciones/enums/notificacion-canal.enum.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { Postulacion } from '../postulaciones/entities/postulacion.entity.js';
import { EstadoPostulacion } from '../postulaciones/enums/estado-postulacion.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { TemaHistorial } from './entities/tema-historial.entity.js';
import { Tema } from './entities/tema.entity.js';
import { EstadoTema } from './enums/estado-tema.enum.js';
import { TemasService } from './temas.service.js';

interface SetupOptions {
  temaEstado?: EstadoTema;
  periodoEstado?: PeriodoEstado;
  vigente?: boolean;
  postulaciones?: Array<{ id: string; estado: EstadoPostulacion; observacion: string | null }>;
}

function setup(options: SetupOptions = {}) {
  const actor = { id: 'admin-id', rol: UsuarioRol.ADMIN };
  const periodo = {
    id: 'periodo-id', estado: options.periodoEstado ?? PeriodoEstado.POSTULACION_CERRADA,
    fecha_inicio_postulacion: new Date(Date.now() - 2 * 3_600_000),
    fecha_fin_postulacion: new Date(Date.now() - 3_600_000),
  };
  const tema = {
    id: 'tema-id', periodo, linea: { id: 'linea-id', codigo: 'IA', nombre: 'IA' },
    docente_proponente: { id: 'docente-id', usuario: { id: 'docente-user', nombres: 'Doc', apellidos: 'Ente' } },
    titulo: 'Tema', descripcion: 'Descripción', min_integrantes: 1, max_integrantes: 3,
    estado: options.temaEstado ?? EstadoTema.PUBLICADO, creado_en: new Date('2026-01-01T00:00:00Z'),
  };
  const postulaciones = (options.postulaciones ?? []).map((item) => ({ ...item }));
  const temaRepo = { findOne: vi.fn(async () => tema), save: vi.fn(async (value: typeof tema) => value) };
  const periodoRepo = { findOne: vi.fn(async () => periodo) };
  const historialRepo = { create: vi.fn((value: unknown) => value), save: vi.fn(async (value: unknown) => value) };
  const asignacionRepo = { exist: vi.fn(async () => options.vigente ?? false) };
  const postulacionRepo = {
    findOneBy: vi.fn(async ({ id }: { id: string }) => postulaciones.find((item) => item.id === id) ?? null),
    save: vi.fn(async (value: unknown) => value),
  };
  const query = vi.fn(async (_sql: string, _params?: unknown[]) => postulaciones.filter((item) => [EstadoPostulacion.PENDIENTE, EstadoPostulacion.EN_CONFLICTO].includes(item.estado)).map(({ id }) => ({ id })));
  const manager = {
    connection: { options: { schema: 'titulacion_dev' } },
    query,
    getRepository: (entity: unknown) => {
      if (entity === Tema) return temaRepo;
      if (entity === PeriodoTitulacion) return periodoRepo;
      if (entity === TemaHistorial) return historialRepo;
      if (entity === AsignacionTema) return asignacionRepo;
      if (entity === Postulacion) return postulacionRepo;
      throw new Error('Repositorio no configurado.');
    },
  };
  const dataSource = {
    transaction: vi.fn(async (isolationOrCallback: unknown, maybeCallback?: (value: typeof manager) => Promise<unknown>) => {
      const callback = typeof isolationOrCallback === 'function' ? isolationOrCallback as (value: typeof manager) => Promise<unknown> : maybeCallback!;
      return callback(manager);
    }),
  };
  const auditoria = { registrar: vi.fn(async () => undefined) };
  const notificaciones = { postulacion: vi.fn(async () => undefined) };
  const service = new TemasService(
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    dataSource as never, auditoria as never, notificaciones as never, { catalogo: async () => construirCatalogo([], []) } as never,
  );
  return { service, actor, tema, periodo, postulaciones, temaRepo, historialRepo, postulacionRepo, query, dataSource, auditoria, notificaciones };
}

describe('TemasService: cierre, retiro y reapertura', () => {
  it('cierra un tema PUBLICADO y rechaza sus postulaciones PENDIENTE y EN_CONFLICTO', async () => {
    const state = setup({
      postulaciones: [
        { id: 'p-1', estado: EstadoPostulacion.PENDIENTE, observacion: null },
        { id: 'p-2', estado: EstadoPostulacion.EN_CONFLICTO, observacion: null },
      ],
    });
    const result = await state.service.close('periodo-id', 'tema-id', { motivo: '  Docente no disponible  ' }, state.actor as never, '127.0.0.1');

    expect(result.estado).toBe(EstadoTema.CERRADO);
    expect(state.dataSource.transaction).toHaveBeenCalledWith('SERIALIZABLE', expect.any(Function));
    expect(state.query).toHaveBeenCalledWith(expect.stringContaining('"titulacion_dev"."postulacion"'), ['periodo-id', 'tema-id']);
    expect(state.query.mock.calls[0]?.[0]).toContain('FOR UPDATE');
    expect(state.postulaciones.map((item) => [item.estado, item.observacion])).toEqual([
      [EstadoPostulacion.RECHAZADA, 'Tema cerrado: Docente no disponible'],
      [EstadoPostulacion.RECHAZADA, 'Tema cerrado: Docente no disponible'],
    ]);
    expect(state.historialRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      estado_anterior: EstadoTema.PUBLICADO, estado_nuevo: EstadoTema.CERRADO,
      cambios: expect.objectContaining({ motivo: 'Docente no disponible' }),
    }));
    const acciones = state.auditoria.registrar.mock.calls.map((call) => (call as unknown[])[1] as { accion: string }).map((entry) => entry.accion);
    expect(acciones).toEqual(['CERRAR_TEMA', 'RECHAZAR_POSTULACION_POR_CIERRE_TEMA', 'RECHAZAR_POSTULACION_POR_CIERRE_TEMA']);
    expect(state.notificaciones.postulacion).toHaveBeenCalledWith(expect.anything(), 'p-1', NotificacionTipo.POSTULACION_RECHAZADA, 'admin-id');
    expect(state.notificaciones.postulacion).toHaveBeenCalledTimes(2);
  });

  it('retira un tema BORRADOR y CERRADO, pero no uno ya RETIRADO', async () => {
    for (const estado of [EstadoTema.BORRADOR, EstadoTema.CERRADO]) {
      const state = setup({ temaEstado: estado });
      const result = await state.service.withdraw('periodo-id', 'tema-id', { motivo: 'Retiro' }, state.actor as never, null);
      expect(result.estado).toBe(EstadoTema.RETIRADO);
      expect(state.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'RETIRAR_TEMA' }));
    }
    const retired = setup({ temaEstado: EstadoTema.RETIRADO });
    await expect(retired.service.withdraw('periodo-id', 'tema-id', { motivo: 'Retiro' }, retired.actor as never, null)).rejects.toBeInstanceOf(ConflictException);
    expect(retired.temaRepo.save).not.toHaveBeenCalled();
  });

  it('rechaza cerrar o retirar un tema con asignación VIGENTE sin modificar postulaciones', async () => {
    for (const options of [{ temaEstado: EstadoTema.ASIGNADO, vigente: true }, { temaEstado: EstadoTema.PUBLICADO, vigente: true }]) {
      const state = setup({ ...options, postulaciones: [{ id: 'p-1', estado: EstadoPostulacion.PENDIENTE, observacion: null }] });
      await expect(state.service.close('periodo-id', 'tema-id', { motivo: 'Cierre' }, state.actor as never, null)).rejects.toThrow(/asignación VIGENTE/);
      await expect(state.service.withdraw('periodo-id', 'tema-id', { motivo: 'Retiro' }, state.actor as never, null)).rejects.toBeInstanceOf(ConflictException);
      expect(state.temaRepo.save).not.toHaveBeenCalled();
      expect(state.postulacionRepo.save).not.toHaveBeenCalled();
      expect(state.auditoria.registrar).not.toHaveBeenCalled();
    }
  });

  it('solo cierra temas PUBLICADOS y nunca en períodos ARCHIVADOS', async () => {
    const draft = setup({ temaEstado: EstadoTema.BORRADOR });
    await expect(draft.service.close('periodo-id', 'tema-id', { motivo: 'Cierre' }, draft.actor as never, null)).rejects.toThrow('Solo se pueden cerrar temas PUBLICADOS.');
    const archived = setup({ periodoEstado: PeriodoEstado.ARCHIVADO });
    await expect(archived.service.close('periodo-id', 'tema-id', { motivo: 'Cierre' }, archived.actor as never, null)).rejects.toBeInstanceOf(ConflictException);
    await expect(archived.service.withdraw('periodo-id', 'tema-id', { motivo: 'Retiro' }, archived.actor as never, null)).rejects.toBeInstanceOf(ConflictException);
    expect(archived.temaRepo.save).not.toHaveBeenCalled();
  });

  it('reabre un tema CERRADO fuera del plazo de postulación y registra historial y auditoría', async () => {
    const state = setup({ temaEstado: EstadoTema.CERRADO });
    const result = await state.service.publish('periodo-id', 'tema-id', {}, state.actor as never, null);
    expect(result.estado).toBe(EstadoTema.PUBLICADO);
    expect(state.historialRepo.save).toHaveBeenCalledWith(expect.objectContaining({ estado_anterior: EstadoTema.CERRADO, estado_nuevo: EstadoTema.PUBLICADO }));
    expect(state.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'REABRIR_TEMA' }));
  });

  it('no reabre temas con asignación VIGENTE, en períodos ARCHIVADOS ni temas RETIRADOS', async () => {
    const assigned = setup({ temaEstado: EstadoTema.CERRADO, vigente: true });
    await expect(assigned.service.publish('periodo-id', 'tema-id', {}, assigned.actor as never, null)).rejects.toBeInstanceOf(ConflictException);
    const archived = setup({ temaEstado: EstadoTema.CERRADO, periodoEstado: PeriodoEstado.ARCHIVADO });
    await expect(archived.service.publish('periodo-id', 'tema-id', {}, archived.actor as never, null)).rejects.toBeInstanceOf(ConflictException);
    const retired = setup({ temaEstado: EstadoTema.RETIRADO, periodoEstado: PeriodoEstado.BORRADOR });
    await expect(retired.service.publish('periodo-id', 'tema-id', {}, retired.actor as never, null)).rejects.toThrow(/BORRADOR o reabrir temas CERRADOS/);
    for (const state of [assigned, archived, retired]) expect(state.temaRepo.save).not.toHaveBeenCalled();
  });

  it('responde 404 si el tema no pertenece al período', async () => {
    const state = setup();
    state.temaRepo.findOne.mockResolvedValueOnce(null as never);
    await expect(state.service.close('periodo-id', 'tema-id', { motivo: 'Cierre' }, state.actor as never, null)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('TemasService: carrera del tema', () => {
  function setupAlta(docenteCarrera = 'car-software') {
    const periodo = { id: 'periodo-id', estado: PeriodoEstado.BORRADOR, facultad_id: 'fac-vida' };
    const linea = { id: 'linea-id', codigo: 'IA', nombre: 'IA', activa: true };
    const cuenta = { id: 'docente-user', nombres: 'Doc', apellidos: 'Ente', estado: UsuarioEstado.ACTIVO, rol: UsuarioRol.DOCENTE };
    const docente = { id: 'docente-id', carrera_id: docenteCarrera, usuario: cuenta };
    const temaRepo = {
      create: vi.fn((value: object) => value),
      save: vi.fn(async (value: object) => ({ id: 'tema-id', ...value })),
      findOne: vi.fn(async () => ({ id: 'tema-id', periodo, linea, docente_proponente: docente, carrera_id: 'car-software', titulo: 'T', descripcion: 'D', min_integrantes: 1, max_integrantes: 2, estado: EstadoTema.BORRADOR, creado_en: new Date() })),
    };
    const repos = new Map<unknown, unknown>([
      [PeriodoTitulacion, { findOne: vi.fn(async () => periodo) }],
      [LineaInvestigacion, { findOne: vi.fn(async () => linea) }],
      [Docente, { findOne: vi.fn(async () => docente) }],
      [Usuario, { findOne: vi.fn(async () => cuenta) }],
      [Tema, temaRepo],
      [TemaHistorial, { create: vi.fn((v: unknown) => v), save: vi.fn(async (v: unknown) => v) }],
    ]);
    const manager = { getRepository: (entity: unknown) => repos.get(entity) };
    const dataSource = { transaction: vi.fn(async (cb: (m: typeof manager) => Promise<unknown>) => cb(manager)) };
    const academico = new AcademicoService();
    vi.spyOn(academico, 'catalogo').mockResolvedValue(construirCatalogo(
      [{ id: 'fac-vida', codigo: 'VIDA', nombre: 'Facultad Ciencias de la Vida y Tecnologías' }, { id: 'fac-salud', codigo: 'SALUD', nombre: 'Facultad Ciencias de la Salud' }],
      [
        { id: 'car-software', codigo: 'INGENIERIA_EN_SOFTWARE', nombre: 'Ingeniería en Software', facultad_id: 'fac-vida' },
        { id: 'car-sistemas', codigo: 'INGENIERIA_EN_SISTEMAS', nombre: 'Ingeniería en Sistemas', facultad_id: 'fac-vida' },
        { id: 'car-medicina', codigo: 'MEDICINA', nombre: 'Medicina', facultad_id: 'fac-salud' },
      ],
    ));
    const service = new TemasService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, dataSource as never, { registrar: vi.fn() } as never, {} as never, academico);
    return { service, temaRepo };
  }
  const dto = { carrera_id: 'car-software', linea_id: 'linea-id', docente_proponente_id: 'docente-id', titulo: 'Tema', descripcion: 'Descripción', min_integrantes: 1, max_integrantes: 2 };

  it('registra el tema con una carrera de la facultad del período y la expone', async () => {
    const state = setupAlta();
    const result = await state.service.create('periodo-id', dto as never, { id: 'admin-id' } as never, null);
    expect(state.temaRepo.create).toHaveBeenCalledWith(expect.objectContaining({ carrera_id: 'car-software' }));
    expect(result.carrera).toEqual({ id: 'car-software', nombre: 'Ingeniería en Software' });
  });

  it('rechaza una carrera que no pertenece a la facultad del período', async () => {
    const state = setupAlta();
    await expect(state.service.create('periodo-id', { ...dto, carrera_id: 'car-medicina' } as never, { id: 'admin-id' } as never, null))
      .rejects.toThrow('La carrera «Medicina» no pertenece a la facultad «Facultad Ciencias de la Vida y Tecnologías» del período.');
    expect(state.temaRepo.save).not.toHaveBeenCalled();
  });

  it('rechaza un docente proponente de otra carrera', async () => {
    const state = setupAlta('car-sistemas');
    await expect(state.service.create('periodo-id', dto as never, { id: 'admin-id' } as never, null))
      .rejects.toThrow('La carrera del docente proponente («Ingeniería en Sistemas») no coincide con la carrera del tema («Ingeniería en Software»).');
    expect(state.temaRepo.save).not.toHaveBeenCalled();
  });
});
