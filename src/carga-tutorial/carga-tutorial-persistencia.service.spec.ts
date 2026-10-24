import { CargaTutorialPersistenciaService } from './carga-tutorial-persistencia.service.js';
import { ConfigCargaOrigen } from './enums/config-carga-origen.enum.js';

describe('CargaTutorialPersistenciaService', () => {
  const service = new CargaTutorialPersistenciaService();

  it('prioriza la configuración específica sobre la global, incluyendo su modalidad', async () => {
    const specific = { id: 'specific', docente_id: 'docente-1', bloquear_al_superar: false };
    const repository = { findOneBy: vi.fn().mockResolvedValueOnce(specific) };
    const manager = { getRepository: vi.fn().mockReturnValue(repository) };

    await expect(service.resolverConfiguracionEfectiva(manager as never, 'periodo-1', 'docente-1'))
      .resolves.toEqual({ origen: ConfigCargaOrigen.DOCENTE, configuracion: specific });
    expect(repository.findOneBy).toHaveBeenCalledTimes(1);
  });

  it('usa el límite global cuando no existe configuración específica', async () => {
    const global = { id: 'global', docente_id: null, max_trabajos: 4, bloquear_al_superar: true };
    const repository = { findOneBy: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(global) };
    const manager = { getRepository: vi.fn().mockReturnValue(repository) };

    await expect(service.resolverConfiguracionEfectiva(manager as never, 'periodo-1', 'docente-1'))
      .resolves.toEqual({ origen: ConfigCargaOrigen.GLOBAL, configuracion: global });
    expect(repository.findOneBy).toHaveBeenCalledTimes(2);
  });

  it('informa que no hay límite sin inventar un valor predeterminado', async () => {
    const repository = { findOneBy: vi.fn().mockResolvedValue(null) };
    const manager = { getRepository: vi.fn().mockReturnValue(repository) };

    await expect(service.resolverConfiguracionEfectiva(manager as never, 'periodo-1', 'docente-1'))
      .resolves.toEqual({ origen: ConfigCargaOrigen.SIN_CONFIGURACION, configuracion: null });
  });
});
