import { describe, expect, it, vi } from 'vitest';
import { AuditoriaService } from './auditoria.service.js';

function setup() {
  const repository = { create: vi.fn((value: unknown) => value), save: vi.fn(async (value: unknown) => value) };
  const manager = { getRepository: () => repository };
  return { service: new AuditoriaService(), manager, repository };
}

const base = {
  accion: 'CERRAR_POSTULACION', entidad_tipo: 'periodo_titulacion', entidad_id: '00000000-0000-4000-8000-000000000001',
  valores_anteriores: { estado: 'POSTULACION_ABIERTA' }, ip_origen: null,
};

describe('AuditoriaService', () => {
  it('registra acciones automáticas sin usuario cuando se marcan como automáticas', async () => {
    const { service, manager, repository } = setup();
    await service.registrar(manager as never, { ...base, actor: null, valores_nuevos: { estado: 'POSTULACION_CERRADA', automatico: true } });
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ usuario: null, accion: 'CERRAR_POSTULACION' }));
  });

  it('rechaza una auditoría sin usuario que no esté marcada como automática', async () => {
    const { service, manager, repository } = setup();
    await expect(service.registrar(manager as never, { ...base, actor: null, valores_nuevos: { estado: 'POSTULACION_CERRADA' } })).rejects.toThrow();
    expect(repository.save).not.toHaveBeenCalled();
  });
});
