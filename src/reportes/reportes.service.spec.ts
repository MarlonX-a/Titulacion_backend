import type { EntityManager } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { ExportacionTipo } from '../exportaciones/enums/exportacion-tipo.enum.js';
import { ReportesService } from './reportes.service.js';

describe('ReportesService', () => {
  it('prepara consultas para los siete reportes con encabezados incluso sin filas', async () => {
    const query = vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []);
    const manager = { connection: { options: { schema: 'test_reportes' } }, query } as unknown as EntityManager;
    const service = new ReportesService({} as never);
    for (const type of Object.values(ExportacionTipo)) {
      const data = await service.generar(manager, 'periodo-id', type, {});
      expect(data.columnas.length).toBeGreaterThan(0);
      expect(data.filas).toEqual([]);
    }
    expect(query).toHaveBeenCalledTimes(7);
    expect(query.mock.calls.every(([sql]) => String(sql).includes('"test_reportes".'))).toBe(true);
  });

  it('mantiene los filtros como parámetros SQL y no concatena sus valores', async () => {
    const query = vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []);
    const manager = { connection: { options: { schema: 'test_reportes' } }, query } as unknown as EntityManager;
    const service = new ReportesService({} as never);
    const hostileValue = "' OR true; --";
    await service.generar(manager, 'periodo-id', ExportacionTipo.TEMAS_OFERTADOS, { linea_id: hostileValue });
    const [sql, parameters] = query.mock.calls[0]!;
    expect(String(sql)).not.toContain(hostileValue);
    expect(parameters).toContain(hostileValue);
  });
});
