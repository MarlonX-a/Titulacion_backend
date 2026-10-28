import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { InvitacionPersistenciaService } from '../invitaciones/invitacion-persistencia.service.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { GrupoIntegrante } from './entities/grupo-integrante.entity.js';
import { Grupo } from './entities/grupo.entity.js';
import { GrupoEstado } from './enums/grupo-estado.enum.js';
import { GrupoIntegranteEstado } from './enums/grupo-integrante-estado.enum.js';
import { GrupoIntegranteRol } from './enums/grupo-integrante-rol.enum.js';

/** Resultado del retiro administrativo de un integrante que quedó NO_ADMITIDO. */
export type RetiroNoAdmision =
  | { resultado: 'SIN_GRUPO' }
  | { resultado: 'RETIRADO'; grupoId: string; grupoEstado: GrupoEstado; nuevoRepresentanteId: string | null };

/**
 * Operaciones de pertenencia a grupos que se ejecutan dentro de la transacción del llamador.
 * No depende de HabilitadosService, por lo que habilitaciones puede usarla sin ciclos de módulos.
 */
@Injectable()
export class GrupoIntegrantePersistenciaService {
  constructor(
    private readonly auditoria: AuditoriaService,
    private readonly invitaciones: InvitacionPersistenciaService,
  ) {}

  lockActiveMembers(manager: EntityManager, groupId: string): Promise<GrupoIntegrante[]> {
    return manager.getRepository(GrupoIntegrante).createQueryBuilder('m').innerJoinAndSelect('m.estudiante', 'e')
      .where('m.grupo_id = :groupId AND m.estado = :state', { groupId, state: GrupoIntegranteEstado.ACTIVO })
      .orderBy('m.estudiante_id', 'ASC').addOrderBy('m.id', 'ASC').setLock('pessimistic_write').getMany();
  }

  async retireMember(manager: EntityManager, member: GrupoIntegrante, reason: string, at: Date): Promise<void> {
    member.estado = GrupoIntegranteEstado.RETIRADO;
    member.fecha_salida = at;
    member.motivo_salida = reason.trim();
    await manager.getRepository(GrupoIntegrante).save(member);
  }

  async updateGroupState(manager: EntityManager, group: Grupo, state: GrupoEstado, actor: Usuario, ip: string | null, action: string, reason: string): Promise<void> {
    if (group.estado === state) return;
    const previous = group.estado;
    group.estado = state;
    await manager.getRepository(Grupo).save(group);
    await this.auditoria.registrar(manager, { actor, accion: action, entidad_tipo: 'grupo', entidad_id: group.id, valores_anteriores: { estado: previous }, valores_nuevos: { estado: state, motivo: reason.trim() }, ip_origen: ip });
  }

  async auditMember(manager: EntityManager, actor: Usuario, action: string, member: GrupoIntegrante, previousState: GrupoIntegranteEstado, ip: string | null, reason: string, previousRole: GrupoIntegranteRol = member.rol_en_grupo): Promise<void> {
    await this.auditoria.registrar(manager, { actor, accion: action, entidad_tipo: 'grupo_integrante', entidad_id: member.id, valores_anteriores: { estado: previousState, rol_en_grupo: previousRole }, valores_nuevos: { estado: member.estado, rol_en_grupo: member.rol_en_grupo, fecha_salida: member.fecha_salida, motivo_salida: member.motivo_salida ?? reason.trim() }, ip_origen: ip });
  }

  /** Estado del grupo tras retirar integrantes: mismas reglas que salir/retirar en la gestión de grupos. */
  nextStateAfterLeaving(group: Grupo, remaining: number): GrupoEstado {
    if (remaining === 0) return GrupoEstado.DISUELTO;
    if (remaining === 1) return GrupoEstado.EN_CONFORMACION;
    return group.estado;
  }

  /**
   * Retiro administrativo del integrante ACTIVO de un estudiante que quedó NO_ADMITIDO, dentro de la
   * transacción del llamador (que ya bloqueó el período). Reutiliza las reglas de retirar integrante:
   * si era representante, el cargo pasa a otro integrante activo (primero los elegibles, ADMITIDO
   * antes que PENDIENTE, luego por antigüedad) y se resuelven las invitaciones pendientes del grupo;
   * el grupo pasa a EN_CONFORMACION con un integrante o a DISUELTO sin integrantes (resolviendo sus
   * invitaciones pendientes). Bloqueo: grupo → integrantes → invitaciones, como la gestión de grupos.
   *
   * También aplica cuando el grupo ya registró postulaciones: el trigger
   * `proteger_composicion_postulacion` admite ACTIVO → RETIRADO solo si la habilitación del
   * integrante está NO_ADMITIDO (migración 20261019100000); el cambio de rol no altera la composición.
   */
  async retirarPorNoAdmision(
    manager: EntityManager,
    periodoId: string,
    estudianteId: string,
    actor: Usuario,
    motivo: string,
    ip: string | null,
  ): Promise<RetiroNoAdmision> {
    const s = this.schema(manager);
    const memberships = await manager.query(`SELECT gi."grupo_id" FROM ${s}."grupo_integrante" gi WHERE gi."periodo_id"=$1 AND gi."estudiante_id"=$2 AND gi."estado"='ACTIVO'`, [periodoId, estudianteId]) as Array<{ grupo_id: string }>;
    const groupId = memberships[0]?.grupo_id;
    if (!groupId) return { resultado: 'SIN_GRUPO' };
    const group = await manager.getRepository(Grupo).findOne({ where: { id: groupId, periodo: { id: periodoId } }, relations: { periodo: true }, lock: { mode: 'pessimistic_write' } });
    if (!group) return { resultado: 'SIN_GRUPO' };
    const members = await this.lockActiveMembers(manager, group.id);
    const target = members.find((item) => item.estudiante.id === estudianteId);
    if (!target) return { resultado: 'SIN_GRUPO' };

    const reason = motivo.trim();
    const previousRole = target.rol_en_grupo;
    let replacement: GrupoIntegrante | undefined;
    if (previousRole === GrupoIntegranteRol.REPRESENTANTE && members.length > 1) {
      replacement = await this.chooseReplacement(manager, group.id, members, target);
      target.rol_en_grupo = GrupoIntegranteRol.INTEGRANTE;
      replacement.rol_en_grupo = GrupoIntegranteRol.REPRESENTANTE;
      const repo = manager.getRepository(GrupoIntegrante);
      await repo.save(target);
      await repo.save(replacement);
      await this.invitaciones.resolverPendientesDelGrupo(manager, group.id, actor, reason, ip, 'CAMBIAR_REPRESENTANTE');
      await this.auditoria.registrar(manager, { actor, accion: 'CAMBIAR_REPRESENTANTE', entidad_tipo: 'grupo', entidad_id: group.id, valores_anteriores: { representante_id: target.estudiante.id }, valores_nuevos: { representante_id: replacement.estudiante.id, motivo: reason, causa: 'NO_ADMISION' }, ip_origen: ip });
    }
    await this.retireMember(manager, target, reason, new Date());
    const nextState = this.nextStateAfterLeaving(group, members.length - 1);
    await this.updateGroupState(manager, group, nextState, actor, ip, 'RETIRAR_INTEGRANTE_NO_ADMISION', reason);
    await this.auditMember(manager, actor, 'RETIRAR_INTEGRANTE_NO_ADMISION', target, GrupoIntegranteEstado.ACTIVO, ip, reason, previousRole);
    if (nextState === GrupoEstado.DISUELTO) await this.invitaciones.resolverPendientesDelGrupo(manager, group.id, actor, reason, ip, 'DISOLVER_GRUPO');
    return { resultado: 'RETIRADO', grupoId: group.id, grupoEstado: nextState, nuevoRepresentanteId: replacement?.estudiante.id ?? null };
  }

  /** Elige el nuevo representante entre los demás integrantes activos ya bloqueados. */
  private async chooseReplacement(manager: EntityManager, groupId: string, members: GrupoIntegrante[], target: GrupoIntegrante): Promise<GrupoIntegrante> {
    const s = this.schema(manager);
    const ranked = await manager.query(`SELECT gi."id" FROM ${s}."grupo_integrante" gi JOIN ${s}."estudiante_habilitado" h ON h."periodo_id"=gi."periodo_id" AND h."estudiante_id"=gi."estudiante_id" WHERE gi."grupo_id"=$1 AND gi."estado"='ACTIVO' AND gi."id"<>$2 ORDER BY (h."estado"='HABILITADO' AND h."situacion_ingreso" IN ('ADMITIDO','PENDIENTE')) DESC, (h."situacion_ingreso"='ADMITIDO') DESC, gi."fecha_ingreso" ASC, gi."id" ASC`, [groupId, target.id]) as Array<{ id: string }>;
    const others = members.filter((item) => item.id !== target.id);
    for (const row of ranked) {
      const found = others.find((item) => item.id === row.id);
      if (found) return found;
    }
    // Sin datos de clasificación se usa el orden de bloqueo; el grupo siempre conserva un representante.
    return others[0]!;
  }

  private schema(manager: EntityManager): string {
    const schema = (manager.connection.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema PostgreSQL configurado no es válido.');
    return `"${schema}"`;
  }
}
