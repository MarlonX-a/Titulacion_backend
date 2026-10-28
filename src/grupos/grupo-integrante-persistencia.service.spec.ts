import { describe, expect, it, vi } from 'vitest';
import { GrupoIntegrante } from './entities/grupo-integrante.entity.js';
import { Grupo } from './entities/grupo.entity.js';
import { GrupoEstado } from './enums/grupo-estado.enum.js';
import { GrupoIntegranteEstado } from './enums/grupo-integrante-estado.enum.js';
import { GrupoIntegranteRol } from './enums/grupo-integrante-rol.enum.js';
import { GrupoIntegrantePersistenciaService } from './grupo-integrante-persistencia.service.js';

interface MemberStub { id: string; estudiante: { id: string }; rol_en_grupo: GrupoIntegranteRol; estado: GrupoIntegranteEstado; fecha_salida: Date | null; motivo_salida: string | null }

function member(id: string, rol = GrupoIntegranteRol.INTEGRANTE): MemberStub {
  return { id, estudiante: { id: `est-${id}` }, rol_en_grupo: rol, estado: GrupoIntegranteEstado.ACTIVO, fecha_salida: null, motivo_salida: null };
}

function setup(options: { members: MemberStub[]; groupState?: GrupoEstado; membership?: boolean; ranking?: string[] }) {
  const calls: string[] = [];
  const group = { id: 'grupo-id', estado: options.groupState ?? GrupoEstado.ACTIVO, periodo: { id: 'periodo-id' } };
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('JOIN') && sql.includes('estudiante_habilitado')) return (options.ranking ?? []).map((id) => ({ id }));
    if (sql.includes('"grupo_integrante" gi')) return options.membership === false ? [] : [{ grupo_id: 'grupo-id' }];
    return [];
  });
  const groupRepo = {
    findOne: vi.fn(async () => { calls.push('lock-grupo'); return group; }),
    save: vi.fn(async (value: unknown) => { calls.push(`grupo:${group.estado}`); return value; }),
  };
  const memberRepo = {
    createQueryBuilder: () => {
      const qb = {
        innerJoinAndSelect: () => qb, where: () => qb, orderBy: () => qb, addOrderBy: () => qb, setLock: () => qb,
        getMany: async () => { calls.push('lock-integrantes'); return options.members; },
      };
      return qb;
    },
    save: vi.fn(async (value: MemberStub) => { calls.push(`save:${value.id}:${value.rol_en_grupo}:${value.estado}`); return value; }),
  };
  const manager = {
    connection: { options: { schema: 'titulacion_dev' } }, query,
    getRepository: (entity: unknown) => entity === Grupo ? groupRepo : entity === GrupoIntegrante ? memberRepo : {},
  };
  const auditoria = { registrar: vi.fn(async (_manager: unknown, entry: { accion: string }) => { calls.push(`audit:${entry.accion}`); }) };
  const invitaciones = { resolverPendientesDelGrupo: vi.fn(async (_m: unknown, _g: string, _a: unknown, _r: string, _ip: unknown, accion: string) => { calls.push(`invitaciones:${accion}`); }) };
  const service = new GrupoIntegrantePersistenciaService(auditoria as never, invitaciones as never);
  return { service, manager, group, calls, groupRepo, memberRepo, auditoria, invitaciones };
}

const actor = { id: 'admin-id' };
const retirar = (state: ReturnType<typeof setup>, estudianteId: string) =>
  state.service.retirarPorNoAdmision(state.manager as never, 'periodo-id', estudianteId, actor as never, ' No admitido ', '10.0.0.1');

describe('GrupoIntegrantePersistenciaService.retirarPorNoAdmision', () => {
  it('no hace nada si el estudiante no pertenece a un grupo activo', async () => {
    const state = setup({ members: [], membership: false });
    await expect(retirar(state, 'est-a')).resolves.toEqual({ resultado: 'SIN_GRUPO' });
    expect(state.groupRepo.findOne).not.toHaveBeenCalled();
    expect(state.auditoria.registrar).not.toHaveBeenCalled();
  });

  it('traspasa la representación al integrante elegible mejor clasificado antes de retirar al representante', async () => {
    const representative = member('a', GrupoIntegranteRol.REPRESENTANTE);
    const state = setup({ members: [representative, member('b'), member('c')], ranking: ['c', 'b'] });
    const result = await retirar(state, 'est-a');
    expect(result).toEqual({ resultado: 'RETIRADO', grupoId: 'grupo-id', grupoEstado: GrupoEstado.ACTIVO, nuevoRepresentanteId: 'est-c' });
    expect(state.calls).toEqual([
      'lock-grupo', 'lock-integrantes',
      'save:a:INTEGRANTE:ACTIVO', 'save:c:REPRESENTANTE:ACTIVO',
      'invitaciones:CAMBIAR_REPRESENTANTE', 'audit:CAMBIAR_REPRESENTANTE',
      'save:a:INTEGRANTE:RETIRADO', 'audit:RETIRAR_INTEGRANTE_NO_ADMISION',
    ]);
    expect(representative).toMatchObject({ estado: GrupoIntegranteEstado.RETIRADO, motivo_salida: 'No admitido', fecha_salida: expect.any(Date) });
    expect(state.auditoria.registrar).toHaveBeenLastCalledWith(state.manager, expect.objectContaining({
      entidad_tipo: 'grupo_integrante', entidad_id: 'a',
      valores_anteriores: { estado: GrupoIntegranteEstado.ACTIVO, rol_en_grupo: GrupoIntegranteRol.REPRESENTANTE },
      valores_nuevos: expect.objectContaining({ estado: GrupoIntegranteEstado.RETIRADO, motivo_salida: 'No admitido' }),
      ip_origen: '10.0.0.1',
    }));
  });

  it('deja EN_CONFORMACION un grupo que queda con un integrante', async () => {
    const state = setup({ members: [member('a', GrupoIntegranteRol.REPRESENTANTE), member('b')] });
    const result = await retirar(state, 'est-b');
    expect(result).toMatchObject({ resultado: 'RETIRADO', grupoEstado: GrupoEstado.EN_CONFORMACION, nuevoRepresentanteId: null });
    expect(state.group.estado).toBe(GrupoEstado.EN_CONFORMACION);
    expect(state.calls).toContain('audit:RETIRAR_INTEGRANTE_NO_ADMISION');
    expect(state.invitaciones.resolverPendientesDelGrupo).not.toHaveBeenCalled();
  });

  it('disuelve el grupo y resuelve sus invitaciones pendientes cuando era el único integrante', async () => {
    const state = setup({ members: [member('a', GrupoIntegranteRol.REPRESENTANTE)], groupState: GrupoEstado.EN_CONFORMACION });
    const result = await retirar(state, 'est-a');
    expect(result).toMatchObject({ resultado: 'RETIRADO', grupoEstado: GrupoEstado.DISUELTO });
    expect(state.calls).toEqual([
      'lock-grupo', 'lock-integrantes', 'save:a:REPRESENTANTE:RETIRADO',
      'grupo:DISUELTO', 'audit:RETIRAR_INTEGRANTE_NO_ADMISION', 'audit:RETIRAR_INTEGRANTE_NO_ADMISION',
      'invitaciones:DISOLVER_GRUPO',
    ]);
  });
});
