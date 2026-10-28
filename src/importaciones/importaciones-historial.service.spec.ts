import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PreparacionImportacion } from './entities/preparacion-importacion.entity.js';
import { LoteImportacionEstado } from './enums/lote-importacion-estado.enum.js';
import { LoteImportacionTipo } from './enums/lote-importacion-tipo.enum.js';
import { PreparacionImportacionEstado as Estado } from './enums/preparacion-importacion-estado.enum.js';
import { ImportacionesHistorialService, toHistorial } from './importaciones-historial.service.js';

const solicitante = { id: 'admin-1', nombres: 'Ada', apellidos: 'Admin' };
const base = {
  id: 'prep-1', tipo: LoteImportacionTipo.ESTUDIANTES, periodo: { id: 'periodo-1' }, nombre_archivo: 'a.xlsx', estado: Estado.INVALIDA,
  total_filas: 5, errores: [{ fila: 2, columna: 'nivel', mensaje: 'x' }, { fila: 2, columna: 'INGLES', mensaje: 'y' }, { fila: 4, columna: 'nivel', mensaje: 'z' }],
  lote: null, solicitada_por: solicitante, creada_en: new Date('2026-10-01T00:00:00Z'), expira_en: new Date('2026-10-01T12:00:00Z'),
} as unknown as PreparacionImportacion;

function setup(periodoExiste = true) {
  const findAndCount = vi.fn(async () => [[base], 1] as const);
  const findOneBy = vi.fn(async () => periodoExiste ? { id: 'periodo-1' } : null);
  const dataSource = { getRepository: (entity: unknown) => entity === PeriodoTitulacion ? { findOneBy } : { findAndCount } };
  return { service: new ImportacionesHistorialService(dataSource as never), findAndCount };
}

describe('ImportacionesHistorialService', () => {
  it('lista las preparaciones del período más recientes primero, sin vista previa y paginadas', async () => {
    const { service, findAndCount } = setup();
    const result = await service.listarEstudiantes('periodo-1', { page: 2, limit: 5 });
    expect(result).toMatchObject({ total: 1, page: 2, limit: 5, data: [{ id: 'prep-1', periodo_id: 'periodo-1', solicitada_por: solicitante }] });
    const options = (findAndCount.mock.calls[0] as unknown as [{ where: unknown; order: unknown; skip: number; take: number; select: Record<string, unknown> }])[0];
    expect(options.where).toEqual({ tipo: LoteImportacionTipo.ESTUDIANTES, periodo: { id: 'periodo-1' } });
    expect(options.order).toEqual({ creada_en: 'DESC', id: 'DESC' });
    expect([options.skip, options.take]).toEqual([5, 5]);
    expect(options.select).not.toHaveProperty('filas');
    expect(options.select).not.toHaveProperty('ruta_almacenamiento');
  });

  it('responde 404 si el período no existe y filtra docentes por tipo', async () => {
    await expect(setup(false).service.listarEstudiantes('otro', { page: 1, limit: 20 })).rejects.toMatchObject({ status: 404 });
    const { service, findAndCount } = setup();
    await service.listarDocentes({ page: 1, limit: 20 });
    expect((findAndCount.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toEqual({ tipo: LoteImportacionTipo.DOCENTES });
  });

  it('marca vencidas sin ocultarlas y cuenta filas distintas con errores', () => {
    const item = toHistorial(base, new Date('2026-10-02T00:00:00Z'));
    expect(item).toMatchObject({ estado: Estado.INVALIDA, expirada: true, filas_error: 2, filas_ok: 3, lote: null });
    expect(toHistorial(base, new Date('2026-10-01T01:00:00Z')).expirada).toBe(false);
  });

  it('usa los contadores del lote cuando la importación se completó', () => {
    const lote = { id: 'lote-1', estado: LoteImportacionEstado.COMPLETADO, total_filas: 5, filas_ok: 5, filas_error: 0, fecha_inicio: new Date(), fecha_fin: new Date() };
    const item = toHistorial({ ...base, estado: Estado.COMPLETADA, errores: [], lote } as unknown as PreparacionImportacion, new Date('2030-01-01'));
    expect(item).toMatchObject({ expirada: false, filas_ok: 5, filas_error: 0, lote: { id: 'lote-1', estado: 'COMPLETADO' } });
  });
});
