import type { Queue } from 'bullmq';
import type { Repository } from 'typeorm';
import { ArchivoLimpiezaService } from './archivo-limpieza.service.js';
import { ArchivoPendiente } from './entities/archivo-pendiente.entity.js';

const sinTareas = { get: vi.fn(() => false) };

describe('ArchivoLimpiezaService', () => {
  it('solo inicia el barrido periódico con BACKGROUND_TASKS_ENABLED=true', () => {
    const repository = { find: vi.fn().mockResolvedValue([]) };
    const queue = { add: vi.fn() };
    new ArchivoLimpiezaService(repository as unknown as Repository<ArchivoPendiente>, queue as unknown as Queue, sinTareas as never).onModuleInit();
    expect(repository.find).not.toHaveBeenCalled();
    const activo = new ArchivoLimpiezaService(repository as unknown as Repository<ArchivoPendiente>, queue as unknown as Queue, { get: vi.fn(() => true) } as never);
    activo.onModuleInit();
    activo.onModuleDestroy();
    expect(repository.find).toHaveBeenCalledTimes(1);
  });

  it('conserva la solicitud en PostgreSQL si Redis no está disponible', async () => {
    const repository = {
      save: vi.fn(), create: vi.fn((value: Partial<ArchivoPendiente>) => value),
      update: vi.fn().mockResolvedValue({ affected: 1 }), find: vi.fn().mockResolvedValue([]),
      findOneBy: vi.fn().mockResolvedValue(null),
    };
    const queue = { add: vi.fn().mockRejectedValue(new Error('redis unavailable')) };
    const service = new ArchivoLimpiezaService(repository as unknown as Repository<ArchivoPendiente>, queue as unknown as Queue, sinTareas as never);
    await service.registrar('period-id', 'documentos-pat/object.pdf');
    await service.solicitar(undefined, 'documentos-pat/object.pdf');
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ periodo_id: 'period-id', ruta_almacenamiento: 'documentos-pat/object.pdf', estado: 'SUBIENDO' }));
    expect(repository.update).toHaveBeenCalledWith({ ruta_almacenamiento: 'documentos-pat/object.pdf' }, { estado: 'LIMPIEZA' });
    expect(queue.add).toHaveBeenCalled();
  });
});
