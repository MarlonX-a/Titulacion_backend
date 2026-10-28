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

  it('ignora límites específicos desactivados para que vuelva a aplicar el global', async () => {
    const global = { id: 'global', docente_id: null, max_trabajos: 4, bloquear_al_superar: true, activa: true };
    const repository = { findOneBy: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(global) };
    const manager = { getRepository: vi.fn().mockReturnValue(repository) };

    await expect(service.resolverConfiguracionEfectiva(manager as never, 'periodo-1', 'docente-1'))
      .resolves.toEqual({ origen: ConfigCargaOrigen.GLOBAL, configuracion: global });
    expect(repository.findOneBy).toHaveBeenNthCalledWith(1, { periodo_id: 'periodo-1', docente_id: 'docente-1', activa: true });
  });

  it('resume la carga de varios docentes con dos consultas y la misma regla de límite efectivo', async () => {
    const global = { id: 'global', docente_id: null, max_trabajos: 4, bloquear_al_superar: true, activa: true };
    const specific = { id: 'specific', docente_id: 'docente-1', max_trabajos: 2, bloquear_al_superar: false, activa: true };
    const inactive = { id: 'old', docente_id: 'docente-2', max_trabajos: 1, bloquear_al_superar: true, activa: false };
    const repository = { find: vi.fn().mockResolvedValue([global, specific, inactive]) };
    const manager = {
      connection: { options: { schema: 'titulacion_dev' } },
      getRepository: vi.fn().mockReturnValue(repository),
      query: vi.fn().mockResolvedValue([{ docente_id: 'docente-1', total: 3 }]),
    };

    const result = await service.resumirCargaDocentes(manager as never, 'periodo-1', ['docente-1', 'docente-2']);

    expect(result.get('docente-1')).toEqual({ origen: ConfigCargaOrigen.DOCENTE, configuracion: specific, actual: 3 });
    // El límite específico inactivo no aplica: vuelve a regir el global.
    expect(result.get('docente-2')).toEqual({ origen: ConfigCargaOrigen.GLOBAL, configuracion: global, actual: 0 });
    expect(repository.find).toHaveBeenCalledTimes(1);
    expect(manager.query).toHaveBeenCalledTimes(1);
    expect(manager.query.mock.calls[0][0]).toContain('GROUP BY tutor."docente_id"');
  });

  it('no consulta cuando no hay docentes', async () => {
    const manager = { getRepository: vi.fn(), query: vi.fn() };
    await expect(service.resumirCargaDocentes(manager as never, 'periodo-1', [])).resolves.toEqual(new Map());
    expect(manager.query).not.toHaveBeenCalled();
  });
});
