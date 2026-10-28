import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { ConfigCargaTutorial } from './entities/config-carga-tutorial.entity.js';
import { CargaTutorialService } from './carga-tutorial.service.js';
import { CargaTutorialPersistenciaService } from './carga-tutorial-persistencia.service.js';

function setup(config: Partial<ConfigCargaTutorial> | null, estado = PeriodoEstado.EN_CURSO) {
  const configs = {
    findOne: vi.fn().mockResolvedValue(config ? { ...config } : null),
    save: vi.fn(async (value: ConfigCargaTutorial) => value),
  };
  const periodos = { findOne: vi.fn().mockResolvedValue({ id: 'periodo-1', estado }) };
  const manager = {
    getRepository: (entity: unknown) => (entity === PeriodoTitulacion ? periodos : entity === ConfigCargaTutorial ? configs : undefined),
  };
  const dataSource = { transaction: async (callback: (value: unknown) => Promise<unknown>) => callback(manager) };
  const auditoria = { registrar: vi.fn().mockResolvedValue(undefined) };
  const service = new CargaTutorialService({} as never, {} as never, {} as never, dataSource as never, auditoria as never, new CargaTutorialPersistenciaService());
  return { service, configs, auditoria };
}

const actor = { id: 'admin' } as Usuario;
const specific = { id: 'c1', periodo_id: 'periodo-1', docente_id: 'docente-1', max_trabajos: 2, bloquear_al_superar: true, activa: true };

describe('CargaTutorialService.deactivate', () => {
  it('desactiva un límite específico sin borrarlo y audita antes/después', async () => {
    const { service, configs, auditoria } = setup(specific);
    await expect(service.deactivate('periodo-1', 'c1', actor, '127.0.0.1')).resolves.toMatchObject({ id: 'c1', activa: false });
    expect(configs.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', activa: false }));
    expect(auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      accion: 'DESACTIVAR_CONFIG_CARGA_TUTORIAL',
      valores_anteriores: expect.objectContaining({ activa: true }),
      valores_nuevos: expect.objectContaining({ activa: false }),
    }));
  });

  it('rechaza el límite global, uno ya desactivado, uno inexistente y períodos archivados', async () => {
    await expect(setup({ ...specific, docente_id: null }).service.deactivate('periodo-1', 'c1', actor, null)).rejects.toBeInstanceOf(ConflictException);
    await expect(setup({ ...specific, activa: false }).service.deactivate('periodo-1', 'c1', actor, null)).rejects.toBeInstanceOf(ConflictException);
    await expect(setup(null).service.deactivate('periodo-1', 'c1', actor, null)).rejects.toBeInstanceOf(NotFoundException);
    await expect(setup(specific, PeriodoEstado.ARCHIVADO).service.deactivate('periodo-1', 'c1', actor, null)).rejects.toBeInstanceOf(ConflictException);
  });

  it('no permite modificar un límite desactivado', async () => {
    const { service, configs } = setup({ ...specific, activa: false });
    await expect(service.update('periodo-1', 'c1', { max_trabajos: 5 }, actor, null)).rejects.toBeInstanceOf(ConflictException);
    expect(configs.save).not.toHaveBeenCalled();
  });
});
