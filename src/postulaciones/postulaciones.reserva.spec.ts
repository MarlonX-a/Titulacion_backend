import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AcademicoService } from '../academico/academico.service.js';
import { construirCatalogo } from '../academico/catalogo-academico.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { Grupo } from '../grupos/entities/grupo.entity.js';
import { GrupoIntegrante } from '../grupos/entities/grupo-integrante.entity.js';
import { GrupoEstado } from '../grupos/enums/grupo-estado.enum.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { Tema } from '../temas/entities/tema.entity.js';
import { EstadoTema } from '../temas/enums/estado-tema.enum.js';
import { TipoTema } from '../temas/enums/tipo-tema.enum.js';
import { PostulacionConfirmacion } from './entities/postulacion-confirmacion.entity.js';
import { Postulacion } from './entities/postulacion.entity.js';
import { EstadoConfirmacion } from './enums/estado-confirmacion.enum.js';
import { EstadoPostulacion } from './enums/estado-postulacion.enum.js';
import { ModalidadPostulacion } from './enums/modalidad-postulacion.enum.js';
import { MENSAJE_TEMA_RESERVADO, PostulacionesService } from './postulaciones.service.js';

function setup(options: { temaEstado?: EstadoTema; liberaVencida?: boolean; tipo?: TipoTema } = {}) {
  const periodo = { id: 'periodo-id', estado: PeriodoEstado.POSTULACION_ABIERTA, max_integrantes_default: 4, fecha_inicio_postulacion: new Date(Date.now() - 3_600_000), fecha_fin_postulacion: new Date(Date.now() + 3_600_000) };
  const tema = { id: 'tema-id', estado: options.temaEstado ?? EstadoTema.PUBLICADO, carrera_id: 'car', tipo: options.tipo ?? TipoTema.INDIVIDUAL };
  const confirmaciones = { create: vi.fn((v: object) => v), save: vi.fn(async (v: object) => v) };
  const postulaciones = { findOne: vi.fn(async () => null), create: vi.fn((v: object) => v), save: vi.fn(async (v: object) => ({ id: 'postulacion-id', ...v })) };
  const integrantes = {
    findOne: vi.fn(async ({ where }: { where: { rol_en_grupo?: string } }) => (where.rol_en_grupo ? { grupo: { id: 'grupo-id' } } : null)),
    find: vi.fn(async () => [{ estudiante: { id: 'est-rep' } }, { estudiante: { id: 'est-b' } }]),
  };
  const repos = new Map<unknown, unknown>([
    [PeriodoTitulacion, { findOne: vi.fn(async () => periodo) }],
    [Tema, { findOne: vi.fn(async () => tema) }],
    [Estudiante, { findOne: vi.fn(async () => ({ id: 'est-rep' })) }],
    [GrupoIntegrante, integrantes],
    [Grupo, { findOne: vi.fn(async () => ({ id: 'grupo-id', estado: GrupoEstado.ACTIVO })) }],
    [Postulacion, postulaciones],
    [PostulacionConfirmacion, confirmaciones],
  ]);
  const manager = { query: vi.fn(async () => []), getRepository: (entity: unknown) => repos.get(entity) };
  const dataSource = { transaction: vi.fn(async (cb: (m: typeof manager) => Promise<unknown>) => cb(manager)) };
  const habilitados = { getEligibleStudentForGroup: vi.fn(async () => ({ carrera_id: 'car' })) };
  const tutores = { agregar: vi.fn(async () => undefined) };
  const reservas = { reservar: vi.fn(async () => undefined), liberarReservasVencidasDelTema: vi.fn(async () => options.liberaVencida ?? false) };
  const academico = new AcademicoService();
  vi.spyOn(academico, 'catalogo').mockResolvedValue(construirCatalogo([{ id: 'fac', codigo: 'F', nombre: 'F' }], [{ id: 'car', codigo: 'C', nombre: 'C', facultad_id: 'fac' }]));
  const service = new PostulacionesService(
    { findOne: vi.fn(async () => null) } as never, {} as never, {} as never, dataSource as never, habilitados as never, { registrar: vi.fn() } as never,
    { resolverPendientesDelGrupo: vi.fn() } as never, tutores as never, { tieneVigenteParaEstudiante: vi.fn(async () => false) } as never,
    { postulacion: vi.fn() } as never, {} as never, reservas as never, academico,
  );
  return { service, tutores, reservas, confirmaciones, postulaciones };
}

const actor = { id: 'user-rep' };
const tutores_propuestos = ['00000000-0000-4000-8000-000000000001'];
const individual = { tema_id: 'tema-id', modalidad: ModalidadPostulacion.INDIVIDUAL, tutores_propuestos };
const grupal = { tema_id: 'tema-id', modalidad: ModalidadPostulacion.GRUPAL, tutores_propuestos };

describe('PostulacionesService: reserva del tema al postular', () => {
  it('rechaza con 409 un tema RESERVADO por otra postulación vigente', async () => {
    const state = setup({ temaEstado: EstadoTema.RESERVADO });
    const result = state.service.create('periodo-id', actor as never, individual as never, null);
    await expect(result).rejects.toBeInstanceOf(ConflictException);
    await expect(result).rejects.toThrow(MENSAJE_TEMA_RESERVADO);
    expect(state.reservas.liberarReservasVencidasDelTema).toHaveBeenCalled();
    expect(state.tutores.agregar).not.toHaveBeenCalled();
  });

  it('vence de forma perezosa una reserva vencida y deja postular', async () => {
    const state = setup({ temaEstado: EstadoTema.RESERVADO, liberaVencida: true });
    // getRecord vuelve a leer con el repositorio vacío del test: termina en 404 tras registrar.
    await expect(state.service.create('periodo-id', actor as never, individual as never, null)).rejects.toBeInstanceOf(NotFoundException);
    expect(state.reservas.reservar).toHaveBeenCalledWith(expect.anything(), 'tema-id', 'postulacion-id', actor, null);
  });

  it('no permite postular a temas que no están PUBLICADOS', async () => {
    const state = setup({ temaEstado: EstadoTema.CERRADO });
    await expect(state.service.create('periodo-id', actor as never, individual as never, null)).rejects.toThrow('Solo se puede postular a temas publicados.');
  });

  it('individual: queda PENDIENTE, con su confirmación CONFIRMADA, y reserva el tema', async () => {
    const state = setup();
    await expect(state.service.create('periodo-id', actor as never, individual as never, null)).rejects.toBeInstanceOf(NotFoundException);
    expect(state.postulaciones.create).toHaveBeenCalledWith(expect.objectContaining({ estado: EstadoPostulacion.PENDIENTE }));
    expect(state.confirmaciones.save).toHaveBeenCalledWith([expect.objectContaining({ postulacion_id: 'postulacion-id', estudiante_id: 'est-rep', estado: EstadoConfirmacion.CONFIRMADA })]);
    expect(state.reservas.reservar).toHaveBeenCalledTimes(1);
  });

  it('grupal: queda PENDIENTE_CONFIRMACION con una fila por integrante y la del representante confirmada', async () => {
    const state = setup({ tipo: TipoTema.PAREJA });
    await expect(state.service.create('periodo-id', actor as never, grupal as never, null)).rejects.toBeInstanceOf(NotFoundException);
    expect(state.postulaciones.create).toHaveBeenCalledWith(expect.objectContaining({ estado: EstadoPostulacion.PENDIENTE_CONFIRMACION, num_integrantes: 2 }));
    const filas = (state.confirmaciones.save.mock.calls[0] as unknown as [Array<{ estudiante_id: string; estado: EstadoConfirmacion; respondida_en: Date | null }>])[0];
    expect(filas.map((fila) => [fila.estudiante_id, fila.estado])).toEqual([['est-rep', EstadoConfirmacion.CONFIRMADA], ['est-b', EstadoConfirmacion.PENDIENTE]]);
    expect(filas[0]!.respondida_en).toBeInstanceOf(Date);
    expect(filas[1]!.respondida_en).toBeNull();
    expect(state.reservas.reservar).toHaveBeenCalledWith(expect.anything(), 'tema-id', 'postulacion-id', actor, null);
  });
});
