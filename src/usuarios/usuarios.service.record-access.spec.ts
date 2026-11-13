import { FindOperator, type DataSource, type Repository } from 'typeorm';
import { vi } from 'vitest';
import type { Usuario } from './entities/usuario.entity.js';
import { ULTIMO_ACCESO_INTERVALO_MS, UsuariosService } from './usuarios.service.js';

function serviceWith(affected: number) {
  const update = vi.fn().mockResolvedValue({ affected });
  const service = new UsuariosService({ update } as unknown as Repository<Usuario>, {} as DataSource);
  return { service, update };
}

const id = '00000000-0000-4000-8000-000000000001';

describe('UsuariosService.recordAccess', () => {
  it('no escribe si el último acceso tiene menos de 5 minutos', async () => {
    const { service, update } = serviceWith(1);
    const reciente = new Date(Date.now() - ULTIMO_ACCESO_INTERVALO_MS + 30_000);

    await expect(service.recordAccess(id, reciente)).resolves.toBe(reciente);
    expect(update).not.toHaveBeenCalled();
  });

  it('escribe con una condición en el UPDATE cuando el acceso es antiguo o nulo', async () => {
    for (const previous of [null, new Date(Date.now() - ULTIMO_ACCESO_INTERVALO_MS - 1_000)]) {
      const { service, update } = serviceWith(1);
      const result = await service.recordAccess(id, previous);

      expect(result).toBeInstanceOf(Date);
      expect(result).not.toBe(previous);
      const [criteria] = update.mock.calls[0] as [Record<string, unknown>];
      expect(criteria.id).toBe(id);
      expect(criteria.ultimo_acceso).toBeInstanceOf(FindOperator);
      expect((criteria.ultimo_acceso as FindOperator<unknown>).type).toBe('or');
    }
  });

  it('si otra solicitud ya escribió (0 filas afectadas) conserva el valor leído', async () => {
    const { service } = serviceWith(0);
    const antiguo = new Date(Date.now() - ULTIMO_ACCESO_INTERVALO_MS * 2);

    await expect(service.recordAccess(id, antiguo)).resolves.toBe(antiguo);
  });
});
