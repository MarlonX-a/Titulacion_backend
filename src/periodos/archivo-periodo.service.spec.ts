import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ArchivoPeriodoService } from './archivo-periodo.service.js';
import { PeriodoEstado } from './enums/periodo-estado.enum.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';

function setup(estado: PeriodoEstado = PeriodoEstado.EN_CURSO, auditoriaFalla = false) {
  const actor = { id: 'admin-id', rol: UsuarioRol.ADMIN, estado: UsuarioEstado.ACTIVO };
  const periodo = {
    id: 'periodo-id', codigo: '2026-1', nombre: 'Período de prueba',
    fecha_inicio_postulacion: new Date('2026-01-01T00:00:00Z'),
    fecha_fin_postulacion: new Date('2026-02-01T00:00:00Z'),
    fecha_inicio_titulacion: new Date('2026-03-01T00:00:00Z'),
    max_integrantes_default: 5, estado,
  };
  const periodRepo = {
    findOne: vi.fn(async () => periodo),
    save: vi.fn(async (value: typeof periodo) => value),
  };
  const userRepo = { findOne: vi.fn(async () => actor) };
  const fakeManager = { getRepository: (entity: unknown) => entity === Usuario ? userRepo : periodRepo };
  const dataSource = { transaction: vi.fn(async (_isolation: string, callback: (manager: typeof fakeManager) => Promise<unknown>) => callback(fakeManager)) };
  const auditoria = { registrar: vi.fn(async () => { if (auditoriaFalla) throw new Error('audit failed'); }) };
  return { service: new ArchivoPeriodoService(dataSource as never, auditoria as never), actor, periodo, periodRepo, userRepo, dataSource, auditoria };
}

describe('ArchivoPeriodoService', () => {
  it('archiva EN_CURSO y registra el motivo en auditoría dentro de una transacción serializable', async () => {
    const state = setup();
    const result = await state.service.archivar('periodo-id', { motivo: '  Cierre administrativo  ' }, state.actor as never, '127.0.0.1');
    expect(result.estado).toBe(PeriodoEstado.ARCHIVADO);
    expect(state.dataSource.transaction).toHaveBeenCalledWith('SERIALIZABLE', expect.any(Function));
    expect(state.auditoria.registrar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      accion: 'ARCHIVAR_PERIODO',
      valores_nuevos: { estado: PeriodoEstado.ARCHIVADO, motivo: 'Cierre administrativo' },
    }));
  });

  it('rechaza un segundo archivo sin escribir auditoría', async () => {
    const state = setup(PeriodoEstado.ARCHIVADO);
    await expect(state.service.archivar('periodo-id', { motivo: 'Cierre' }, state.actor as never, null)).rejects.toBeInstanceOf(ConflictException);
    expect(state.periodRepo.save).not.toHaveBeenCalled();
    expect(state.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('vuelve a comprobar que la cuenta siga siendo ADMIN activa', async () => {
    const state = setup();
    state.userRepo.findOne.mockResolvedValue({ ...state.actor, estado: UsuarioEstado.INACTIVO });
    await expect(state.service.archivar('periodo-id', { motivo: 'Cierre' }, state.actor as never, null)).rejects.toBeInstanceOf(ConflictException);
    expect(state.periodRepo.save).not.toHaveBeenCalled();
  });

  it('propaga el fallo de auditoría para revertir la transacción', async () => {
    const state = setup(PeriodoEstado.EN_CURSO, true);
    await expect(state.service.archivar('periodo-id', { motivo: 'Cierre' }, state.actor as never, null)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
