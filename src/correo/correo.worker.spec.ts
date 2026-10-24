import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import type { Job } from 'bullmq';
import { CorreoWorker } from './correo.worker.js';
import { SmtpTransportService } from './smtp-transport.service.js';
import { EntregaCorreoEstado } from '../notificaciones/enums/entrega-correo-estado.enum.js';

describe('CorreoWorker: notificaciones', () => {
  const delivery = { notificacion_id: 'notification-id', usuario_id: 'user-id', email: 'destino@example.test', titulo: 'PAT revisado', mensaje: 'Versión 2 aprobada.', intentos: 1, reserva_token: randomUUID() };

  function setup(rows: unknown[] = [delivery], send = vi.fn().mockResolvedValue(undefined)) {
    const txQuery = vi.fn(async (sql: string) => sql.includes('RETURNING "notificacion_id"') ? [{ notificacion_id: delivery.notificacion_id }] : []);
    const query = vi.fn(async (sql: string, _parameters?: unknown[]) => {
      if (sql.includes('RETURNING n."id" AS notificacion_id')) return rows;
      if (sql.includes('SELECT 1 FROM')) return rows.length ? [{ ok: 1 }] : [];
      return [];
    });
    const dataSource = {
      options: { schema: 'test_schema' },
      query,
      transaction: vi.fn(async (callback: (manager: { query: typeof txQuery }) => Promise<unknown>) => callback({ query: txQuery })),
    } as unknown as DataSource;
    const smtp = { send } as unknown as SmtpTransportService;
    const config = { get: () => undefined };
    const worker = new CorreoWorker(dataSource, config as never, smtp);
    const job = { name: 'enviar-notificacion', data: { id: 'delivery-id', generation: 0 } } as Job<{ id: string; generation: number }>;
    return { worker, dataSource, query, smtp: send, txQuery, job };
  }

  it('reclama, envía por SMTP y confirma la entrega y la fecha del aviso', async () => {
    const { worker, query, smtp, txQuery, job } = setup();
    await worker.process(job);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SET \"estado\"='PROCESANDO'"), ['delivery-id', 0, expect.any(String)]);
    expect(smtp).toHaveBeenCalledWith({ to: delivery.email, subject: delivery.titulo, text: expect.stringContaining(delivery.mensaje) });
    expect(txQuery).toHaveBeenCalledTimes(2);
    expect(txQuery.mock.calls[0]?.[0]).toContain("'ENVIADO'");
    expect(txQuery.mock.calls[1]?.[0]).toContain('"fecha_envio"=CURRENT_TIMESTAMP');
  });

  it('omite cuentas inactivas sin intentar SMTP', async () => {
    const { worker, query, smtp, job } = setup([]);
    await worker.process(job);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[0]).toContain("SET \"estado\"='OMITIDO'");
    expect(smtp).not.toHaveBeenCalled();
  });

  it.each([[2, EntregaCorreoEstado.PENDIENTE], [5, EntregaCorreoEstado.FALLIDO]])('sanitiza el error SMTP y define el estado tras el intento %i', async (intentos, estado) => {
    const send = vi.fn().mockRejectedValue(new Error('host secreto y respuesta SMTP privada'));
    const { worker, query, job } = setup([{ ...delivery, intentos }], send);
    await expect(worker.process(job)).rejects.toMatchObject({ status: 503 });
    const update = query.mock.calls.at(-1);
    expect(update?.[0]).toContain("'No fue posible entregar el correo.'");
    expect(update?.[1]).toEqual(['delivery-id', expect.any(String), estado]);
    expect(update?.[0]).not.toContain('privada');
  });

  it('valida el esquema antes de interpolarlo en las consultas', async () => {
    const { worker, dataSource, job } = setup();
    Object.defineProperty(dataSource, 'options', { value: { schema: 'unsafe"; DROP SCHEMA public;--' } });
    await expect(worker.process(job)).rejects.toMatchObject({ status: 503 });
  });

  it('ignora un trabajo de una generación anterior sin enviar el correo', async () => {
    const { worker, query, smtp } = setup([]);
    await worker.process({ name: 'enviar-notificacion', data: { id: 'delivery-id', generation: 3 } } as Job<{ id: string; generation: number }>);
    expect(query.mock.calls[0]?.[1]).toEqual(['delivery-id', 3, expect.any(String)]);
    expect(smtp).not.toHaveBeenCalled();
  });
});
