import { Injectable } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import { ConfigCargaOrigen } from './enums/config-carga-origen.enum.js';
import { ConfigCargaTutorial } from './entities/config-carga-tutorial.entity.js';

export interface ConfiguracionCargaEfectiva {
  origen: ConfigCargaOrigen;
  configuracion: ConfigCargaTutorial | null;
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
}
