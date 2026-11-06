import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Auditoria } from './entities/auditoria.entity.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';

export interface AuditoriaInput {
  /**
   * Usuario responsable. `null` solo para acciones automáticas del sistema, que deben incluir
   * `valores_nuevos.automatico = true` (lo exige `CHK_auditoria_actor_o_automatico`).
   */
  actor: Usuario | null;
  accion: string;
  entidad_tipo: string;
  entidad_id: string;
  valores_anteriores: Record<string, unknown> | null;
  valores_nuevos: Record<string, unknown> | null;
  ip_origen: string | null;
}

@Injectable()
export class AuditoriaService {
  async registrar(manager: EntityManager, input: AuditoriaInput): Promise<void> {
    if (input.actor === null && input.valores_nuevos?.['automatico'] !== true) {
      throw new Error('Una auditoría sin usuario solo se permite para acciones automáticas.');
    }
    const repository = manager.getRepository(Auditoria);
    await repository.save(repository.create({
      usuario: input.actor,
      accion: input.accion,
      entidad_tipo: input.entidad_tipo,
      entidad_id: input.entidad_id,
      valores_anteriores: input.valores_anteriores,
      valores_nuevos: input.valores_nuevos,
      ip_origen: input.ip_origen,
      fecha_hora: new Date(),
    }));
  }
}
