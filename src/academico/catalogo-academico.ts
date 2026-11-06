import type { Carrera } from './entities/carrera.entity.js';
import type { Facultad } from './entities/facultad.entity.js';

export interface CarreraCatalogo { id: string; codigo: string; nombre: string; facultad_id: string; }
export interface FacultadCatalogo { id: string; codigo: string; nombre: string; carreras: CarreraCatalogo[]; }
export interface CatalogoAcademico {
  facultades: FacultadCatalogo[];
  facultad(id: string): FacultadCatalogo | undefined;
  carrera(id: string): CarreraCatalogo | undefined;
}

const porNombre = (a: { nombre: string }, b: { nombre: string }) => a.nombre.localeCompare(b.nombre, 'es');

/** Agrupa las carreras por facultad, ordenadas por nombre (es). */
export function construirCatalogo(
  facultades: Array<Pick<Facultad, 'id' | 'codigo' | 'nombre'>>,
  carreras: Array<Pick<Carrera, 'id' | 'codigo' | 'nombre' | 'facultad_id'>>,
): CatalogoAcademico {
  const lista: FacultadCatalogo[] = facultades
    .map((f) => ({
      id: f.id, codigo: f.codigo, nombre: f.nombre,
      carreras: carreras.filter((c) => c.facultad_id === f.id)
        .map((c) => ({ id: c.id, codigo: c.codigo, nombre: c.nombre, facultad_id: c.facultad_id }))
        .sort(porNombre),
    }))
    .sort(porNombre);
  const facultadPorId = new Map(lista.map((f) => [f.id, f]));
  const carreraPorId = new Map(lista.flatMap((f) => f.carreras.map((c) => [c.id, c] as const)));
  return { facultades: lista, facultad: (id) => facultadPorId.get(id), carrera: (id) => carreraPorId.get(id) };
}

/** Resumen `{ id, nombre }` para respuestas; un id sin catálogo devuelve nombre vacío. */
export function resumenCatalogo(item: { nombre: string } | undefined, id: string): { id: string; nombre: string } {
  return { id, nombre: item?.nombre ?? '' };
}
