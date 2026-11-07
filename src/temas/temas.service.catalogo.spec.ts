import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AcademicoService } from '../academico/academico.service.js';
import { construirCatalogo } from '../academico/catalogo-academico.js';
import { HabilitadoEstado } from '../habilitados/enums/habilitado-estado.enum.js';
import { SituacionIngreso } from '../habilitados/enums/situacion-ingreso.enum.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { EstadoTema } from './enums/estado-tema.enum.js';
import { TipoTema } from './enums/tipo-tema.enum.js';
import { TemasService } from './temas.service.js';

interface Postulacion { tema_id: string; periodo_id: string; archivado: boolean }

function tema(id: string, carreraId: string, estado = EstadoTema.PUBLICADO) {
  const cuenta = { id: 'docente-user', nombres: 'Doc', apellidos: 'Ente', estado: UsuarioEstado.ACTIVO, rol: UsuarioRol.DOCENTE };
  return {
    id, carrera_id: carreraId, linea: { id: 'linea-id', codigo: 'IA', nombre: 'IA', activa: true },
    docente_proponente: { id: 'docente-id', carrera_id: carreraId, usuario: cuenta }, tipo: TipoTema.GRUPO,
    titulo: `Tema ${id}`, descripcion: 'Descripción', estado, lote_importacion_id: null, creado_en: new Date('2026-01-01T00:00:00Z'),
  };
}

function setup(postulaciones: Postulacion[] = []) {
  const temas = [tema('t-software', 'car-software'), tema('t-sistemas', 'car-sistemas'), tema('t-borrador', 'car-software', EstadoTema.BORRADOR)];
  const repository = {
    findAndCount: vi.fn(async ({ where }: { where: { carrera_id?: string; estado?: unknown } }) => {
      const rows = temas.filter((item) => (!where.carrera_id || item.carrera_id === where.carrera_id) && (typeof where.estado !== 'string' || item.estado === where.estado));
      return [rows, rows.length];
    }),
    findOne: vi.fn(async ({ where }: { where: { id: string } }) => temas.find((item) => item.id === where.id) ?? null),
  };
  const periodo = { id: 'periodo-id', estado: PeriodoEstado.POSTULACION_ABIERTA, max_integrantes_default: 5 };
  const estudianteRepository = { findOne: vi.fn(async () => ({ id: 'estudiante-id', carrera_id: 'car-software' })) };
  const habilitadoRepository = { findOne: vi.fn(async () => ({ estado: HabilitadoEstado.HABILITADO, situacion_ingreso: SituacionIngreso.ADMITIDO })) };
  const periodoRepository = { findOneBy: vi.fn(async () => periodo) };
  // Emulates the availability query, including the predicate that excludes applications of ARCHIVADO periods.
  const query = vi.fn(async (sql: string, params: [string | null, string[]]) => {
    const excludesArchived = sql.includes(`pe."estado"='ARCHIVADO'`);
    return params[1].map((id) => ({
      id, disponible: true,
      postulaciones_abiertas: postulaciones.filter((p) => p.tema_id === id && (params[0] === null || p.periodo_id === params[0]) && !(excludesArchived && p.archivado)).length,
    }));
  });
  const dataSource = { options: { schema: 'titulacion_dev' }, query };
  const academico = new AcademicoService();
  vi.spyOn(academico, 'catalogo').mockResolvedValue(construirCatalogo(
    [{ id: 'fac-vida', codigo: 'VIDA', nombre: 'Facultad Ciencias de la Vida y Tecnologías' }],
    [
      { id: 'car-software', codigo: 'INGENIERIA_EN_SOFTWARE', nombre: 'Ingeniería en Software', facultad_id: 'fac-vida' },
      { id: 'car-sistemas', codigo: 'INGENIERIA_EN_SISTEMAS', nombre: 'Ingeniería en Sistemas', facultad_id: 'fac-vida' },
    ],
  ));
  const service = new TemasService(
    repository as never, {} as never, {} as never, estudianteRepository as never, habilitadoRepository as never, periodoRepository as never,
    dataSource as never, {} as never, {} as never, academico,
  );
  return { service, repository, query };
}

const student = { id: 'student-user', rol: UsuarioRol.ESTUDIANTE };
const admin = { id: 'admin-id', rol: UsuarioRol.ADMIN };
const page = { page: 1, limit: 20 };

describe('TemasService: student catalog scoped to the student career', () => {
  it('lists only PUBLICADO topics of the student career, even when another carrera_id is requested', async () => {
    const state = setup();
    const result = await state.service.list({ ...page, periodo_id: 'periodo-id', carrera_id: 'car-sistemas' } as never, student as never);
    expect(state.repository.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ carrera_id: 'car-software', estado: EstadoTema.PUBLICADO }) }));
    expect(result.data.map((item) => item.id)).toEqual(['t-software']);
  });

  it('cannot fetch a topic of another career by id', async () => {
    const state = setup();
    await expect(state.service.getById('t-sistemas', { periodo_id: 'periodo-id' } as never, student as never)).rejects.toBeInstanceOf(NotFoundException);
    await expect(state.service.getById('t-software', { periodo_id: 'periodo-id' } as never, student as never)).resolves.toMatchObject({ id: 't-software' });
  });
});

describe('TemasService: availability enrichment', () => {
  it('does not count open applications of ARCHIVADO periods', async () => {
    const state = setup([
      { tema_id: 't-software', periodo_id: 'periodo-id', archivado: false },
      { tema_id: 't-software', periodo_id: 'periodo-viejo', archivado: true },
    ]);
    const result = await state.service.getById('t-software', {} as never, admin as never);
    expect(state.query.mock.calls[0]![0]).toContain(`"periodo_titulacion" pe WHERE pe."id"=p."periodo_id" AND pe."estado"='ARCHIVADO'`);
    expect(result.postulaciones_abiertas).toBe(1);
  });
});
