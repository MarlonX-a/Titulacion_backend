import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Auditoria } from './entities/auditoria.entity.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';

export interface AuditoriaInput {
  actor: Usuario;
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
