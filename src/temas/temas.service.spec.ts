import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AcademicoService } from '../academico/academico.service.js';
import { construirCatalogo } from '../academico/catalogo-academico.js';
import { AsignacionTema } from '../asignaciones-tema/entities/asignacion-tema.entity.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { LineaInvestigacion } from '../lineas-investigacion/entities/linea-investigacion.entity.js';
import { NotificacionTipo } from '../notificaciones/enums/notificacion-canal.enum.js';
import { Postulacion } from '../postulaciones/entities/postulacion.entity.js';
import { EstadoPostulacion } from '../postulaciones/enums/estado-postulacion.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { TemaHistorial } from './entities/tema-historial.entity.js';
import { Tema } from './entities/tema.entity.js';
import { EstadoTema } from './enums/estado-tema.enum.js';
import { TipoTema } from './enums/tipo-tema.enum.js';
import { TemasService } from './temas.service.js';

interface SetupOptions {
  temaEstado?: EstadoTema;
  vigente?: boolean;
  abiertas?: number;
  docenteCarrera?: string;
  encontrado?: boolean;
  postulaciones?: Array<{ id: string; estado: EstadoPostulacion; observacion: string | null; archivado?: boolean }>;
}

const ABIERTAS = [EstadoPostulacion.PENDIENTE, EstadoPostulacion.EN_CONFLICTO];

function setup(options: SetupOptions = {}) {
  const actor = { id: 'admin-id', rol: UsuarioRol.ADMIN };
  const cuenta = { id: 'docente-user', nombres: 'Doc', apellidos: 'Ente', estado: UsuarioEstado.ACTIVO, rol: UsuarioRol.DOCENTE };
  const docente = { id: 'docente-id', carrera_id: options.docenteCarrera ?? 'car-software', usuario: cuenta };
  const linea = { id: 'linea-id', codigo: 'IA', nombre: 'IA', activa: true };
  const tema = {
    id: 'tema-id', carrera_id: 'car-software', linea, docente_proponente: docente, tipo: TipoTema.GRUPO,
    titulo: 'Tema', descripcion: 'Descripción', estado: options.temaEstado ?? EstadoTema.PUBLICADO,
    lote_importacion_id: null, creado_en: new Date('2026-01-01T00:00:00Z'),
  };
  const postulaciones = (options.postulaciones ?? []).map((item) => ({ ...item }));
  const temaRepo = {
    findOne: vi.fn(async () => (options.encontrado === false ? null : tema)),
    save: vi.fn(async (value: object) => ({ id: 'tema-id', ...value })),
    create: vi.fn((value: object) => value),
  };
  const historialRepo = { create: vi.fn((value: unknown) => value), save: vi.fn(async (value: unknown) => value) };
  const asignacionRepo = { exist: vi.fn(async () => options.vigente ?? false) };
  const postulacionRepo = {
    findOneBy: vi.fn(async ({ id }: { id: string }) => postulaciones.find((item) => item.id === id) ?? null),
    save: vi.fn(async (value: unknown) => value),
  };
  // Emulates the SQL predicate that excludes applications of ARCHIVADO periods.
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    const excludesArchived = sql.includes(`pe."estado"='ARCHIVADO'`);
    const open = postulaciones.filter((item) => ABIERTAS.includes(item.estado) && !(excludesArchived && item.archivado));
    if (sql.includes('count(*)')) return [{ total: options.abiertas ?? open.length }];
    return open.map(({ id }) => ({ id }));
  });
  const repos = new Map<unknown, unknown>([
    [Tema, temaRepo],
    [TemaHistorial, historialRepo],
    [AsignacionTema, asignacionRepo],
    [Postulacion, postulacionRepo],
    [LineaInvestigacion, { findOne: vi.fn(async () => linea) }],
    [Docente, { findOne: vi.fn(async () => docente) }],
    [Usuario, { findOne: vi.fn(async () => cuenta) }],
  ]);
  const manager = { connection: { options: { schema: 'titulacion_dev' } }, query, getRepository: (entity: unknown) => repos.get(entity) };
  const dataSource = {
    transaction: vi.fn(async (isolationOrCallback: unknown, maybeCallback?: (value: typeof manager) => Promise<unknown>) => {
      const callback = typeof isolationOrCallback === 'function' ? isolationOrCallback as (value: typeof manager) => Promise<unknown> : maybeCallback!;
      return callback(manager);
    }),
  };
  const auditoria = { registrar: vi.fn(async () => undefined) };
  const notificaciones = { postulacion: vi.fn(async () => undefined) };
  const academico = new AcademicoService();
  vi.spyOn(academico, 'catalogo').mockResolvedValue(construirCatalogo(
    [{ id: 'fac-vida', codigo: 'VIDA', nombre: 'Facultad Ciencias de la Vida y Tecnologías' }],
    [
      { id: 'car-software', codigo: 'INGENIERIA_EN_SOFTWARE', nombre: 'Ingeniería en Software', facultad_id: 'fac-vida' },
      { id: 'car-sistemas', codigo: 'INGENIERIA_EN_SISTEMAS', nombre: 'Ingeniería en Sistemas', facultad_id: 'fac-vida' },
    ],
  ));
  const service = new TemasService(
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    dataSource as never, auditoria as never, notificaciones as never, academico,
  );
  return { service, actor, tema, postulaciones, temaRepo, historialRepo, postulacionRepo, query, auditoria, notificaciones };
}

const alta = { carrera_id: 'car-software', linea_id: 'linea-id', docente_proponente_id: 'docente-id', tipo: TipoTema.GRUPO, titulo: 'Tema', descripcion: 'Descripción' };

describe('TemasService: alta en el banco de la carrera', () => {
  it('registra un BORRADOR con tipo, sin período, y expone el rango derivado', async () => {
    const state = setup({ temaEstado: EstadoTema.BORRADOR });
    const result = await state.service.create(alta as never, state.actor as never, null);
    expect(state.temaRepo.create).toHaveBeenCalledWith(expect.objectContaining({ carrera_id: 'car-software', tipo: TipoTema.GRUPO, estado: EstadoTema.BORRADOR, lote_importacion_id: null }));
    expect(result).toMatchObject({ tipo: TipoTema.GRUPO, min_integrantes: 3, max_integrantes: null, carrera: { id: 'car-software', nombre: 'Ingeniería en Software' } });
    expect(result).not.toHaveProperty('periodo_id');
  });

  it('rechaza una carrera inexistente', async () => {
    const state = setup();
    await expect(state.service.create({ ...alta, carrera_id: 'car-x' } as never, state.actor as never, null)).rejects.toThrow('No existe la carrera indicada.');
    expect(state.temaRepo.save).not.toHaveBeenCalled();
  });

  it('rechaza un docente proponente de otra carrera', async () => {
    const state = setup({ docenteCarrera: 'car-sistemas' });
    await expect(state.service.create(alta as never, state.actor as never, null))
      .rejects.toThrow('La carrera del docente proponente («Ingeniería en Sistemas») no coincide con la carrera del tema («Ingeniería en Software»).');
    expect(state.temaRepo.save).not.toHaveBeenCalled();
  });
});

describe('TemasService: regla de edición', () => {
  it('edita un tema PUBLICADO sin asignación VIGENTE y registra historial y auditoría', async () => {
    const state = setup();
    const result = await state.service.update('tema-id', { titulo: 'Nuevo título' } as never, state.actor as never, '127.0.0.1');
    expect(result.titulo).toBe('Nuevo título');
    expect(state.historialRepo.save).toHaveBeenCalledWith(expect.objectContaining({ estado_anterior: EstadoTema.PUBLICADO, estado_nuevo: EstadoTema.PUBLICADO }));
    expect(state.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'ACTUALIZAR_TEMA', entidad_id: 'tema-id' }));
  });

  it('bloquea la edición con asignación VIGENTE', async () => {
    const state = setup({ vigente: true });
    await expect(state.service.update('tema-id', { titulo: 'Otro' } as never, state.actor as never, null)).rejects.toThrow(/asignación VIGENTE/);
    expect(state.temaRepo.save).not.toHaveBeenCalled();
  });

  it('impide cambiar tipo o carrera con postulaciones abiertas', async () => {
    const state = setup({ abiertas: 2 });
    await expect(state.service.update('tema-id', { tipo: TipoTema.PAREJA } as never, state.actor as never, null)).rejects.toBeInstanceOf(ConflictException);
    expect(state.temaRepo.save).not.toHaveBeenCalled();
  });

  it('allows changing tipo when the only open applications belong to ARCHIVADO periods', async () => {
    const state = setup({ postulaciones: [{ id: 'p-archived', estado: EstadoPostulacion.PENDIENTE, observacion: null, archivado: true }] });
    const result = await state.service.update('tema-id', { tipo: TipoTema.PAREJA } as never, state.actor as never, null);
    expect(result).toMatchObject({ tipo: TipoTema.PAREJA });
    expect(state.query).toHaveBeenCalledWith(expect.stringContaining(`pe."estado"='ARCHIVADO'`), ['tema-id']);
  });

  it('cambia el tipo cuando no hay postulaciones abiertas', async () => {
    const state = setup();
    const result = await state.service.update('tema-id', { tipo: TipoTema.PAREJA } as never, state.actor as never, null);
    expect(result).toMatchObject({ tipo: TipoTema.PAREJA, min_integrantes: 2, max_integrantes: 2 });
  });

  it('exige al menos un campo', async () => {
    const state = setup();
    await expect(state.service.update('tema-id', {} as never, state.actor as never, null)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('TemasService: cierre, retiro y reapertura', () => {
  it('cierra un tema PUBLICADO y rechaza sus postulaciones abiertas de cualquier período', async () => {
    const state = setup({
      postulaciones: [
        { id: 'p1', estado: EstadoPostulacion.PENDIENTE, observacion: null },
        { id: 'p2', estado: EstadoPostulacion.EN_CONFLICTO, observacion: null },
        { id: 'p3', estado: EstadoPostulacion.ACEPTADA, observacion: null },
      ],
    });
    const result = await state.service.close('tema-id', { motivo: '  Docente no disponible  ' }, state.actor as never, '127.0.0.1');
    expect(result.estado).toBe(EstadoTema.CERRADO);
    expect(state.query).toHaveBeenCalledWith(expect.stringContaining('"tema_id"=$1'), ['tema-id']);
    expect(state.postulaciones.map((item) => item.estado)).toEqual([EstadoPostulacion.RECHAZADA, EstadoPostulacion.RECHAZADA, EstadoPostulacion.ACEPTADA]);
    expect(state.postulaciones[0]!.observacion).toBe('Tema cerrado: Docente no disponible');
    expect(state.notificaciones.postulacion).toHaveBeenCalledTimes(2);
    expect(state.notificaciones.postulacion).toHaveBeenCalledWith(expect.anything(), 'p1', NotificacionTipo.POSTULACION_RECHAZADA, 'admin-id');
    expect(state.historialRepo.save).toHaveBeenCalledWith(expect.objectContaining({ estado_anterior: EstadoTema.PUBLICADO, estado_nuevo: EstadoTema.CERRADO, cambios: expect.objectContaining({ motivo: 'Docente no disponible' }) }));
  });

  it('ignores open applications of ARCHIVADO periods when closing a topic', async () => {
    const state = setup({
      postulaciones: [
        { id: 'p-open', estado: EstadoPostulacion.PENDIENTE, observacion: null },
        { id: 'p-archived', estado: EstadoPostulacion.PENDIENTE, observacion: null, archivado: true },
      ],
    });
    await state.service.close('tema-id', { motivo: 'Cierre' }, state.actor as never, null);
    expect(state.query.mock.calls[0]![0]).toContain(`"periodo_titulacion" pe WHERE pe."id"=p."periodo_id" AND pe."estado"='ARCHIVADO'`);
    expect(state.postulaciones.map((item) => item.estado)).toEqual([EstadoPostulacion.RECHAZADA, EstadoPostulacion.PENDIENTE]);
    expect(state.postulacionRepo.save).toHaveBeenCalledTimes(1);
    expect(state.notificaciones.postulacion).toHaveBeenCalledTimes(1);
    expect(state.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'RECHAZAR_POSTULACION_POR_CIERRE_TEMA', entidad_id: 'p-open' }));
  });

  it('retira temas BORRADOR y CERRADO, pero no uno ya RETIRADO', async () => {
    for (const estado of [EstadoTema.BORRADOR, EstadoTema.CERRADO]) {
      const state = setup({ temaEstado: estado });
      const result = await state.service.withdraw('tema-id', { motivo: 'Retiro' }, state.actor as never, null);
      expect(result.estado).toBe(EstadoTema.RETIRADO);
    }
    const retired = setup({ temaEstado: EstadoTema.RETIRADO });
    await expect(retired.service.withdraw('tema-id', { motivo: 'Retiro' }, retired.actor as never, null)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza cerrar o retirar un tema con asignación VIGENTE', async () => {
    const state = setup({ vigente: true });
    await expect(state.service.close('tema-id', { motivo: 'Cierre' }, state.actor as never, null)).rejects.toThrow(/asignación VIGENTE/);
    await expect(state.service.withdraw('tema-id', { motivo: 'Retiro' }, state.actor as never, null)).rejects.toBeInstanceOf(ConflictException);
    expect(state.postulacionRepo.save).not.toHaveBeenCalled();
  });

  it('solo cierra temas PUBLICADOS', async () => {
    const draft = setup({ temaEstado: EstadoTema.BORRADOR });
    await expect(draft.service.close('tema-id', { motivo: 'Cierre' }, draft.actor as never, null)).rejects.toThrow('Solo se pueden cerrar temas PUBLICADOS.');
  });

  it('reabre un tema CERRADO y registra historial y auditoría', async () => {
    const state = setup({ temaEstado: EstadoTema.CERRADO });
    const result = await state.service.publish('tema-id', {}, state.actor as never, null);
    expect(result.estado).toBe(EstadoTema.PUBLICADO);
    expect(state.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'REABRIR_TEMA' }));
  });

  it('no reabre temas con asignación VIGENTE ni publica temas RETIRADOS', async () => {
    const assigned = setup({ temaEstado: EstadoTema.CERRADO, vigente: true });
    await expect(assigned.service.publish('tema-id', {}, assigned.actor as never, null)).rejects.toBeInstanceOf(ConflictException);
    const retired = setup({ temaEstado: EstadoTema.RETIRADO });
    await expect(retired.service.publish('tema-id', {}, retired.actor as never, null)).rejects.toThrow(/BORRADOR o reabrir temas CERRADOS/);
  });

  it('responde 404 si el tema no existe', async () => {
    const state = setup({ encontrado: false });
    await expect(state.service.close('tema-id', { motivo: 'Cierre' }, state.actor as never, null)).rejects.toBeInstanceOf(NotFoundException);
  });
});
