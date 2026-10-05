import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

@Injectable()
export class PostulacionPersistenciaService {
  private schema(manager: EntityManager): string {
    const schema = (manager.connection.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema PostgreSQL configurado no es válido.');
    return `"${schema}"`;
  }

  async grupoTienePostulaciones(manager: EntityManager, grupoId: string): Promise<boolean> {
    const rows = await manager.query(`SELECT 1 FROM ${this.schema(manager)}."postulacion" WHERE "grupo_id" = $1 LIMIT 1`, [grupoId]) as unknown[];
    return rows.length > 0;
  }

  async estudianteTienePostulacionIndividualActiva(manager: EntityManager, periodoId: string, estudianteId: string): Promise<boolean> {
    const rows = await manager.query(`SELECT 1 FROM ${this.schema(manager)}."postulacion" WHERE "periodo_id" = $1 AND "estudiante_id" = $2 AND "estado" IN ('PENDIENTE','EN_CONFLICTO','ACEPTADA') LIMIT 1`, [periodoId, estudianteId]) as unknown[];
    return rows.length > 0;
  }
}
