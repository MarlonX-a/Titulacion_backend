import { describe, expect, it, vi } from 'vitest';
import { AuditoriaService, ENTIDAD_SEGURIDAD_SIN_CUENTA, EVENTOS_SEGURIDAD, type EventoSeguridad } from './auditoria.service.js';

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

  describe('registrarEventoSeguridad', () => {
    const usuarioId = '00000000-0000-4000-8000-0000000000aa';

    it('registra el evento como acción del sistema sobre el usuario afectado, con IP', async () => {
      const { service, manager, repository } = setup();
      await service.registrarEventoSeguridad(manager as never, 'LOGIN_EXITOSO', { usuarioId, ip: '10.0.0.5' });
      expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({
        usuario: null, accion: 'LOGIN_EXITOSO', entidad_tipo: 'usuario', entidad_id: usuarioId,
        valores_anteriores: null, valores_nuevos: { automatico: true }, ip_origen: '10.0.0.5',
      }));
    });

    it('descarta contraseñas, hashes, códigos, tokens y cookies a cualquier profundidad', async () => {
      const { service, manager, repository } = setup();
      await service.registrarEventoSeguridad(manager as never, 'RECUPERACION_COMPLETADA', {
        usuarioId, ip: null,
        detalles: {
          motivo: 'reset', password: 'x', current_password: 'x', codigo: 'x', code: 'x', codigo_hash: 'x', refresh_token: 'x',
          cookie: 'x', csrf: 'x', clave_temporal: 'x', automatico: false,
          sesion: { id: 's-1', refresh_anterior_hash: 'x', tokenDigest: 'x' }, intentos: [{ secret: 'x', n: 1 }],
        },
      });
      const saved = repository.save.mock.calls[0]![0] as { valores_nuevos: Record<string, unknown> };
      expect(saved.valores_nuevos).toEqual({ motivo: 'reset', sesion: { id: 's-1' }, intentos: [{ n: 1 }], automatico: true });
    });

    it('sin cuenta usa una entidad de seguridad fija y descarta una IP inválida', async () => {
      const { service, manager, repository } = setup();
      await service.registrarEventoSeguridad(manager as never, 'LOGIN_BLOQUEADO', { usuarioId: null, ip: 'no-es-ip' });
      expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({
        entidad_tipo: 'seguridad', entidad_id: ENTIDAD_SEGURIDAD_SIN_CUENTA, ip_origen: null,
      }));
    });

    it('sin manager inserta con el DataSource, fuera de cualquier transacción', async () => {
      const { manager, repository } = setup();
      const service = new AuditoriaService({ manager } as never);
      await service.registrarEventoSeguridad(null, 'LOGOUT', { usuarioId, ip: null });
      expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ accion: 'LOGOUT' }));
    });

    it('rechaza eventos desconocidos y usuarios que no son UUID', async () => {
      const { service, manager, repository } = setup();
      await expect(service.registrarEventoSeguridad(manager as never, 'BORRAR_TODO' as EventoSeguridad, { usuarioId, ip: null })).rejects.toThrow('desconocido');
      await expect(service.registrarEventoSeguridad(manager as never, 'LOGOUT', { usuarioId: "1' OR '1'='1", ip: null })).rejects.toThrow('usuario');
      await expect(new AuditoriaService().registrarEventoSeguridad(null, 'LOGOUT', { usuarioId, ip: null })).rejects.toThrow('conexión');
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('expone exactamente los eventos del diseño S1 más PRIMER_ACCESO_MASIVO (S2)', () => {
      expect(EVENTOS_SEGURIDAD).toEqual([
        'LOGIN_EXITOSO', 'LOGIN_FALLIDO', 'LOGIN_BLOQUEADO', 'FUERZA_BRUTA_SOSPECHADA', 'PRIMER_ACCESO', 'PRIMER_ACCESO_MASIVO', 'CAMBIO_CLAVE',
        'RECUPERACION_SOLICITADA', 'RECUPERACION_COMPLETADA', 'SESION_REUSO_DETECTADO', 'SESION_INACTIVA', 'LOGOUT',
      ]);
    });
  });

  it('rechaza una auditoría sin usuario que no esté marcada como automática', async () => {
    const { service, manager, repository } = setup();
    await expect(service.registrar(manager as never, { ...base, actor: null, valores_nuevos: { estado: 'POSTULACION_CERRADA' } })).rejects.toThrow();
    expect(repository.save).not.toHaveBeenCalled();
  });
});
