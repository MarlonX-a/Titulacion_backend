import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AcademicoService } from '../academico/academico.service.js';
import { construirCatalogo } from '../academico/catalogo-academico.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { GrupoIntegrante } from '../grupos/entities/grupo-integrante.entity.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { Tema } from '../temas/entities/tema.entity.js';
import { EstadoTema } from '../temas/enums/estado-tema.enum.js';
import { TipoTema } from '../temas/enums/tipo-tema.enum.js';
import { Postulacion } from './entities/postulacion.entity.js';
import { ModalidadPostulacion } from './enums/modalidad-postulacion.enum.js';
import { PostulacionesService } from './postulaciones.service.js';

function setup(carreraEstudiante: string, tipo: TipoTema = TipoTema.INDIVIDUAL) {
  const periodo = { id: 'periodo-id', estado: PeriodoEstado.POSTULACION_ABIERTA, facultad_id: 'fac-vida', max_integrantes_default: 4, fecha_inicio_postulacion: new Date(Date.now() - 3_600_000), fecha_fin_postulacion: new Date(Date.now() + 3_600_000) };
  const tema = { id: 'tema-id', estado: EstadoTema.PUBLICADO, carrera_id: 'car-software', tipo };
  const repos = new Map<unknown, unknown>([
    [PeriodoTitulacion, { findOne: vi.fn(async () => periodo) }],
    [Tema, { findOne: vi.fn(async () => tema) }],
    [Estudiante, { findOne: vi.fn(async () => ({ id: 'estudiante-id' })) }],
    [GrupoIntegrante, { findOne: vi.fn(async () => null) }],
    [Postulacion, { findOne: vi.fn(async () => null), create: vi.fn((v: object) => v), save: vi.fn(async (v: object) => ({ id: 'postulacion-id', ...v })) }],
  ]);
  const manager = { query: vi.fn(async () => []), getRepository: (entity: unknown) => repos.get(entity) };
  const dataSource = { transaction: vi.fn(async (cb: (m: typeof manager) => Promise<unknown>) => cb(manager)) };
  const habilitados = { getEligibleStudentForGroup: vi.fn(async () => ({ id: 'estudiante-id', carrera_id: carreraEstudiante })) };
  const asignaciones = { tieneVigenteParaEstudiante: vi.fn(async () => false) };
  const tutores = { agregar: vi.fn(async () => undefined) };
  const academico = new AcademicoService();
  vi.spyOn(academico, 'catalogo').mockResolvedValue(construirCatalogo(
    [{ id: 'fac-vida', codigo: 'VIDA', nombre: 'Vida' }],
    [{ id: 'car-software', codigo: 'SOFTWARE', nombre: 'Ingeniería en Software', facultad_id: 'fac-vida' }, { id: 'car-sistemas', codigo: 'SISTEMAS', nombre: 'Ingeniería en Sistemas', facultad_id: 'fac-vida' }],
  ));
  const repository = { findOne: vi.fn(async () => null) };
  const service = new PostulacionesService(
    repository as never, {} as never, {} as never, dataSource as never, habilitados as never, { registrar: vi.fn() } as never,
    {} as never, tutores as never, asignaciones as never, { postulacion: vi.fn() } as never, {} as never, academico,
  );
  return { service, asignaciones, tutores };
}

const dto = { tema_id: 'tema-id', modalidad: ModalidadPostulacion.INDIVIDUAL, tutores_propuestos: ['00000000-0000-4000-8000-000000000001'] };

describe('PostulacionesService carrera', () => {
  it('rechaza postular a un tema de otra carrera', async () => {
    const state = setup('car-sistemas');
    await expect(state.service.create('periodo-id', { id: 'user-id' } as never, dto as never, null))
      .rejects.toThrow('La carrera del estudiante («Ingeniería en Sistemas») no coincide con la carrera del tema («Ingeniería en Software»).');
    expect(state.asignaciones.tieneVigenteParaEstudiante).not.toHaveBeenCalled();
  });

  it('permite postular a un tema de la misma carrera (llega a registrar tutores)', async () => {
    const state = setup('car-software');
    // getRecord vuelve a leer con el repositorio vacío del test, por eso termina en 404 tras registrar.
    await expect(state.service.create('periodo-id', { id: 'user-id' } as never, dto as never, null)).rejects.toBeInstanceOf(NotFoundException);
    expect(state.tutores.agregar).toHaveBeenCalled();
  });
});

describe('PostulacionesService rango de integrantes por tipo', () => {
  it('rechaza una postulación individual a un tema PAREJA', async () => {
    const state = setup('car-software', TipoTema.PAREJA);
    await expect(state.service.create('periodo-id', { id: 'user-id' } as never, dto as never, null))
      .rejects.toThrow('El tema PAREJA admite 2 integrante(s); la solicitud tiene 1.');
    expect(state.tutores.agregar).not.toHaveBeenCalled();
  });

  it('rechaza una postulación individual a un tema GRUPO', async () => {
    const state = setup('car-software', TipoTema.GRUPO);
    await expect(state.service.create('periodo-id', { id: 'user-id' } as never, dto as never, null))
      .rejects.toThrow('El tema GRUPO admite entre 3 y 4 integrante(s); la solicitud tiene 1.');
    expect(state.tutores.agregar).not.toHaveBeenCalled();
  });
});
