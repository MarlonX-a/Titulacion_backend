import { NotificacionesService } from './notificaciones.service.js';
import { NotificacionCanal } from './enums/notificacion-canal.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { Notificacion } from './entities/notificacion.entity.js';

describe('NotificacionesService', () => {
  const user = { id: 'user-1' } as Usuario;
  const base: Notificacion = { id: 'notification-1', usuario_id: user.id, usuario: user, tipo: 'PAT_REVISADO', titulo: 'PAT revisado', mensaje: 'Consulta el resultado.', entidad_tipo: 'revision_pat', entidad_id: 'revision-1', canal: NotificacionCanal.EN_APP, leida: false, fecha_creacion: new Date('2026-10-08T00:00:00Z'), fecha_envio: new Date('2026-10-08T00:00:00Z') };

  function setup() {
    const records = [base, { ...base, id: 'other-user', usuario_id: 'other', entidad_id: 'revision-2' }, { ...base, id: 'email-copy', canal: NotificacionCanal.EMAIL }];
    const repository = {
      findAndCount: vi.fn(async (options: { where: Partial<Notificacion> }) => { const rows = records.filter((record) => Object.entries(options.where).every(([key, value]) => record[key as keyof Notificacion] === value)); return [rows, rows.length] as const; }),
      count: vi.fn(async (options: { where: Partial<Notificacion> }) => records.filter((record) => Object.entries(options.where).every(([key, value]) => record[key as keyof Notificacion] === value)).length),
      findOneBy: vi.fn(async (where: Partial<Notificacion>) => records.find((record) => Object.entries(where).every(([key, value]) => record[key as keyof Notificacion] === value)) ?? null),
      update: vi.fn(async (where: Partial<Notificacion>, values: Partial<Notificacion>) => { const record = records.find((row) => Object.entries(where).every(([key, value]) => row[key as keyof Notificacion] === value)); if (record) Object.assign(record, values); return { affected: record ? 1 : 0 }; }),
    };
    const service = new NotificacionesService(repository as never, {} as never);
    return { service, repository };
  }

  it('limita la bandeja al usuario y al canal de aplicación', async () => {
    const { service } = setup();
    const result = await service.listar(user, { page: 1, limit: 20 });
    expect(result).toMatchObject({ total: 1, data: [{ id: 'notification-1', canal: NotificacionCanal.EN_APP }] });
    expect(result.data[0]).not.toHaveProperty('usuario_id');
  });

  it('cuenta y marca como leída sin afectar otro usuario', async () => {
    const { service, repository } = setup();
    expect(await service.contador(user)).toEqual({ total: 1 });
    expect((await service.marcarLeida(base.id, user)).leida).toBe(true);
    expect(repository.update).toHaveBeenCalledWith({ id: base.id, usuario_id: user.id, canal: NotificacionCanal.EN_APP }, { leida: true });
  });

  it('oculta registros ajenos y las copias del canal correo', async () => {
    const { service } = setup();
    await expect(service.porId('other-user', user)).rejects.toMatchObject({ status: 404 });
    await expect(service.porId('email-copy', user)).rejects.toMatchObject({ status: 404 });
    await expect(service.marcarLeida('other-user', user)).rejects.toMatchObject({ status: 404 });
  });
});
