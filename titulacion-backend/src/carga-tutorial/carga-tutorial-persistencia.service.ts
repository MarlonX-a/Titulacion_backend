import { Injectable } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
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

@Injectable()
export class CargaTutorialPersistenciaService {
  async resolverConfiguracionEfectiva(
    manager: EntityManager,
    periodoId: string,
    docenteId: string,
  ): Promise<ConfiguracionCargaEfectiva> {
    const repository = manager.getRepository(ConfigCargaTutorial);
    const especifica = await repository.findOneBy({ periodo_id: periodoId, docente_id: docenteId });
    if (especifica) return { origen: ConfigCargaOrigen.DOCENTE, configuracion: especifica };

    const global = await repository.findOneBy({ periodo_id: periodoId, docente_id: IsNull() });
    if (global) return { origen: ConfigCargaOrigen.GLOBAL, configuracion: global };
    return { origen: ConfigCargaOrigen.SIN_CONFIGURACION, configuracion: null };
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
