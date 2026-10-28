import { QueryFailedError } from 'typeorm';
import { AuditoriaConsultaService, escapeLike, redactSensitive } from './auditoria-consulta.service.js';
import type { ListAuditoriaQueryDto } from './dto/list-auditoria-query.dto.js';

const row = {
  id: '42', accion: 'EDITAR_TEMA', entidad_tipo: 'tema', entidad_id: '00000000-0000-4000-8000-0000000000aa',
  valores_anteriores: { titulo: 'A' }, valores_nuevos: { titulo: 'B', password_hash: 'x', nested: { refresh_token: 'y' } },
  ip_origen: '10.0.0.5', fecha_hora: new Date('2026-10-02T10:00:00Z'),
  actor_id: '00000000-0000-4000-8000-000000000001', actor_email: 'admin@uleam.edu.ec', actor_nombres: 'Ada', actor_apellidos: 'Admin', actor_rol: 'ADMIN',
};

function setup(schema = 'titulacion_dev') {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => sql.startsWith('SELECT count') ? [{ total: '7' }] : [row]);
  const service = new AuditoriaConsultaService({ options: { schema }, query } as never);
  return { service, query };
}
const q = (values: Partial<ListAuditoriaQueryDto> = {}) => ({ page: 1, limit: 20, ...values }) as ListAuditoriaQueryDto;

describe('AuditoriaConsultaService', () => {
  it('ordena por fecha y id descendentes, pagina y devuelve el id bigint como texto', async () => {
    const { service, query } = setup();
    const result = await service.listar(q({ page: 3, limit: 10 }));
    expect(result).toMatchObject({ total: 7, page: 3, limit: 10, data: [{ id: '42', actor: { email: 'admin@uleam.edu.ec', rol: 'ADMIN' }, ip_origen: '10.0.0.5' }] });
    const [sql, params] = query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('FROM "titulacion_dev"."auditoria" a JOIN "titulacion_dev"."usuario" u');
    expect(sql).toContain('ORDER BY a."fecha_hora" DESC, a."id" DESC LIMIT $1 OFFSET $2');
    expect(params).toEqual([10, 20]);
  });

  it('aplica filtros exactos y texto libre parametrizado con comodines escapados', async () => {
    const { service, query } = setup();
    await service.listar(q({ entidad_tipo: 'tema', entidad_id: row.entidad_id, accion: 'EDITAR_TEMA', usuario_id: row.actor_id, q: '50%_a\\b' }));
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('a."entidad_tipo" = $1 AND a."entidad_id" = $2::uuid AND a."accion" = $3 AND a."usuario_id" = $4::uuid');
    expect(sql).toContain('u."email" ILIKE $5 ESCAPE');
    expect(sql).not.toContain('50%');
    expect(params).toEqual(['tema', row.entidad_id, 'EDITAR_TEMA', row.actor_id, '%50\\%\\_a\\\\b%']);
  });

  it('trata una fecha hasta sin hora como el día completo y valida el rango', async () => {
    const { service, query } = setup();
    await service.listar(q({ desde: '2026-10-02', hasta: '2026-10-02' }));
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('a."fecha_hora" >= $1::timestamptz AND a."fecha_hora" < $2::timestamptz');
    expect(params).toEqual([new Date('2026-10-02T00:00:00Z'), new Date('2026-10-03T00:00:00Z')]);
    await expect(service.listar(q({ desde: '2026-10-05', hasta: '2026-10-02' }))).rejects.toMatchObject({ status: 400 });
    await service.listar(q({ hasta: '2026-10-02T12:00:00Z' }));
    expect(query.mock.calls.at(-1)?.[0]).toContain('a."fecha_hora" <= $1::timestamptz');
  });

  it('oculta claves sensibles en los valores auditados', async () => {
    const { service } = setup();
    const [item] = (await service.listar(q())).data;
    expect(item.valores_nuevos).toEqual({ titulo: 'B', password_hash: '[REDACTADO]', nested: { refresh_token: '[REDACTADO]' } });
    expect(redactSensitive(null)).toBeNull();
    expect(escapeLike('a_b')).toBe('a\\_b');
  });

  it('rechaza un esquema inválido y traduce errores de PostgreSQL a 503', async () => {
    await expect(setup('Bad-Schema').service.listar(q())).rejects.toMatchObject({ status: 503 });
    const failing = new AuditoriaConsultaService({ options: { schema: 'x' }, query: vi.fn(async () => { throw new QueryFailedError('SELECT', [], new Error('down')); }) } as never);
    await expect(failing.listar(q())).rejects.toMatchObject({ status: 503 });
  });
});
