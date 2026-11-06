import { BadRequestException, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { construirCatalogo, type CarreraCatalogo, type CatalogoAcademico, type FacultadCatalogo } from './catalogo-academico.js';
import { Carrera } from './entities/carrera.entity.js';
import { Facultad } from './entities/facultad.entity.js';

/** Un DataSource o un EntityManager: solo se necesita obtener repositorios. */
export type FuenteRepositorios = Pick<EntityManager, 'getRepository'>;

/**
 * Catálogo de facultades y carreras. Es inmutable en ejecución (solo cambia por migración), así
 * que se carga una vez por proceso y se reutiliza para validar y para armar respuestas.
 */
@Injectable()
export class AcademicoService {
  private cargando: Promise<CatalogoAcademico> | null = null;

  catalogo(fuente: FuenteRepositorios): Promise<CatalogoAcademico> {
    if (!this.cargando) {
      this.cargando = (async () => {
        const facultades = await fuente.getRepository(Facultad).find();
        const carreras = await fuente.getRepository(Carrera).find();
        return construirCatalogo(facultades, carreras);
      })().catch((error: unknown) => {
        this.cargando = null;
        throw error;
      });
    }
    return this.cargando;
  }

  async buscarFacultad(fuente: FuenteRepositorios, facultadId: string): Promise<FacultadCatalogo> {
    const facultad = (await this.catalogo(fuente)).facultad(facultadId);
    if (!facultad) throw new BadRequestException('No existe la facultad indicada.');
    return facultad;
  }

  async buscarCarrera(fuente: FuenteRepositorios, carreraId: string): Promise<CarreraCatalogo> {
    const carrera = (await this.catalogo(fuente)).carrera(carreraId);
    if (!carrera) throw new BadRequestException('No existe la carrera indicada.');
    return carrera;
  }

  async assertCarreraEnFacultad(fuente: FuenteRepositorios, carreraId: string, facultadId: string): Promise<CarreraCatalogo> {
    const carrera = await this.buscarCarrera(fuente, carreraId);
    const facultad = await this.buscarFacultad(fuente, facultadId);
    if (carrera.facultad_id !== facultad.id) {
      throw new BadRequestException(`La carrera «${carrera.nombre}» no pertenece a la facultad «${facultad.nombre}» del período.`);
    }
    return carrera;
  }

  async assertMismaCarrera(fuente: FuenteRepositorios, carreraId: string, carreraTemaId: string, sujeto: string): Promise<void> {
    if (carreraId === carreraTemaId) return;
    const catalogo = await this.catalogo(fuente);
    const actual = catalogo.carrera(carreraId)?.nombre ?? carreraId;
    const tema = catalogo.carrera(carreraTemaId)?.nombre ?? carreraTemaId;
    throw new BadRequestException(`La carrera ${sujeto} («${actual}») no coincide con la carrera del tema («${tema}»).`);
  }
}
