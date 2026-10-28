import { Injectable } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import { EntityManager, In, IsNull } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { ConfigCargaOrigen } from './enums/config-carga-origen.enum.js';
import { ConfigCargaTutorial } from './entities/config-carga-tutorial.entity.js';

export interface ConfiguracionCargaEfectiva {
  origen: ConfigCargaOrigen;
  configuracion: ConfigCargaTutorial | null;
}

export interface EvaluacionCargaTutorial {
  actual: number;
  proyectada: number;
  excede_limite: boolean;
  origen: ConfigCargaOrigen.DOCENTE | ConfigCargaOrigen.GLOBAL;
  configuracion: ConfigCargaTutorial;
  advertencia: string | null;
}

/** Regla única: el límite específico activo prevalece; si no existe, aplica el global. */
export function elegirConfiguracion(
  especifica: ConfigCargaTutorial | null,
  global: ConfigCargaTutorial | null,
): ConfiguracionCargaEfectiva {
  if (especifica) return { origen: ConfigCargaOrigen.DOCENTE, configuracion: especifica };
  if (global) return { origen: ConfigCargaOrigen.GLOBAL, configuracion: global };
  return { origen: ConfigCargaOrigen.SIN_CONFIGURACION, configuracion: null };
}

@Injectable()
export class CargaTutorialPersistenciaService {
  async resolverConfiguracionEfectiva(
    manager: EntityManager,
    periodoId: string,
    docenteId: string,
  ): Promise<ConfiguracionCargaEfectiva> {
    const repository = manager.getRepository(ConfigCargaTutorial);
    // Un límite específico desactivado se conserva como historial pero ya no aplica.
    const especifica = await repository.findOneBy({ periodo_id: periodoId, docente_id: docenteId, activa: true });
    if (especifica) return elegirConfiguracion(especifica, null);
    const global = await repository.findOneBy({ periodo_id: periodoId, docente_id: IsNull() });
    return elegirConfiguracion(null, global);
  }

  /**
   * Carga actual y configuración efectiva de varios docentes con dos consultas (límites activos
   * del período y conteo agrupado), aplicando la misma regla que `resolverConfiguracionEfectiva`.
   */
  async resumirCargaDocentes(
    manager: EntityManager,
    periodoId: string,
    docenteIds: string[],
  ): Promise<Map<string, ConfiguracionCargaEfectiva & { actual: number }>> {
    const result = new Map<string, ConfiguracionCargaEfectiva & { actual: number }>();
    if (!docenteIds.length) return result;
    const configs = await manager.getRepository(ConfigCargaTutorial).find({
      where: [
        { periodo_id: periodoId, docente_id: IsNull() },
        { periodo_id: periodoId, docente_id: In(docenteIds), activa: true },
      ],
    });
    const global = configs.find((config) => config.docente_id === null) ?? null;
    const schema = this.schema(manager);
    const rows = await manager.query(
      `SELECT tutor."docente_id", count(*)::int AS total
       FROM ${schema}."asignacion_tutor" tutor
       JOIN ${schema}."asignacion_tema" trabajo ON trabajo."id" = tutor."asignacion_tema_id"
       WHERE trabajo."periodo_id" = $1 AND tutor."docente_id" = ANY($2::uuid[])
         AND tutor."estado" = 'VIGENTE' AND trabajo."estado" = 'VIGENTE'
       GROUP BY tutor."docente_id"`,
      [periodoId, docenteIds],
    ) as Array<{ docente_id: string; total: number }>;
    const counts = new Map(rows.map((row) => [row.docente_id, Number(row.total)]));
    for (const docenteId of docenteIds) {
      const especifica = configs.find((config) => config.docente_id === docenteId && config.activa) ?? null;
      result.set(docenteId, { ...elegirConfiguracion(especifica, global), actual: counts.get(docenteId) ?? 0 });
    }
    return result;
  }

  async contarCargaActual(manager: EntityManager, periodoId: string, docenteId: string): Promise<number> {
    const schema = this.schema(manager);
    const rows = await manager.query(
      `SELECT count(*)::int AS total
       FROM ${schema}."asignacion_tutor" tutor
       JOIN ${schema}."asignacion_tema" trabajo ON trabajo."id" = tutor."asignacion_tema_id"
       WHERE trabajo."periodo_id" = $1 AND tutor."docente_id" = $2
         AND tutor."estado" = 'VIGENTE' AND trabajo."estado" = 'VIGENTE'`,
      [periodoId, docenteId],
    ) as Array<{ total: number }>;
    return Number(rows[0]?.total ?? 0);
  }

  async evaluarCargaProyectada(
    manager: EntityManager,
    periodoId: string,
    docenteId: string,
  ): Promise<EvaluacionCargaTutorial> {
    const effective = await this.resolverConfiguracionEfectiva(manager, periodoId, docenteId);
    const actual = await this.contarCargaActual(manager, periodoId, docenteId);
    if (!effective.configuracion || effective.origen === ConfigCargaOrigen.SIN_CONFIGURACION) {
      throw new ConflictException('Configura un límite de carga para el docente antes de asignar tutorías.');
    }
    const proyectada = actual + 1;
    const excede_limite = proyectada > effective.configuracion.max_trabajos;
    return {
      actual,
      proyectada,
      excede_limite,
      origen: effective.origen,
      configuracion: effective.configuracion,
      advertencia: excede_limite && !effective.configuracion.bloquear_al_superar
        ? `La carga proyectada (${proyectada}) supera el máximo configurado (${effective.configuracion.max_trabajos}).`
        : null,
    };
  }

  private schema(manager: EntityManager): string {
    const value = (manager.connection.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('El esquema PostgreSQL configurado no es válido.');
    return `"${value}"`;
  }
}
