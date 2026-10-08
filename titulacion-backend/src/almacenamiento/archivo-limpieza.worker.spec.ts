import type { DataSource } from 'typeorm';
import type { Job } from 'bullmq';
import { AlmacenamientoService } from './almacenamiento.service.js';
import { ArchivoLimpiezaWorker } from './archivo-limpieza.worker.js';

describe('ArchivoLimpiezaWorker', () => {
  it('no elimina objetos que ya tengan referencia histórica', async () => {
    const manager = { query: vi.fn()
      .mockResolvedValueOnce([{ periodo_id: 'period-id' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'pending-id', estado: 'LIMPIEZA', creado_en: new Date() }])
      .mockResolvedValueOnce([{ referenced: true }])
      .mockResolvedValueOnce([]) };
    const dataSource = { options: { schema: 'test_files' }, transaction: (work: (tx: typeof manager) => Promise<void>) => work(manager) } as unknown as DataSource;
    const storage = { removePrivate: vi.fn() } as unknown as AlmacenamientoService;
    const worker = new ArchivoLimpiezaWorker(dataSource, storage);
    await worker.process({ name: 'limpiar-archivo-no-referenciado', data: { key: 'documentos-pat/object.pdf' } } as Job<{ key: string }>);
    expect(storage.removePrivate).not.toHaveBeenCalled();
    expect(manager.query).toHaveBeenCalledTimes(5);
  });

  it('elimina un objeto fallido no referenciado y consume la intención', async () => {
    const manager = { query: vi.fn()
      .mockResolvedValueOnce([{ periodo_id: 'period-id' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'pending-id', estado: 'LIMPIEZA', creado_en: new Date() }])
      .mockResolvedValueOnce([{ referenced: false }])
      .mockResolvedValueOnce([]) };
    const dataSource = { options: { schema: 'test_files' }, transaction: (work: (tx: typeof manager) => Promise<void>) => work(manager) } as unknown as DataSource;
    const storage = { removePrivate: vi.fn().mockResolvedValue(undefined) } as unknown as AlmacenamientoService;
    const worker = new ArchivoLimpiezaWorker(dataSource, storage);
    await worker.process({ name: 'limpiar-archivo-no-referenciado', data: { key: 'plantillas-pat/object.pdf' } } as Job<{ key: string }>);
    expect(storage.removePrivate).toHaveBeenCalledWith('plantillas-pat/object.pdf');
    expect(manager.query).toHaveBeenCalledTimes(5);
  });
});
