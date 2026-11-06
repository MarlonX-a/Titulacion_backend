import { EstadoTema } from './enums/estado-tema.enum.js';

/** A topic is available when it is PUBLICADO and has no VIGENTE assignment. */
export function estaDisponible(estado: EstadoTema, tieneAsignacionVigente: boolean): boolean {
  return estado === EstadoTema.PUBLICADO && !tieneAsignacionVigente;
}

/** Any topic without a VIGENTE assignment can be edited (ASIGNADO always has one, see TRG_tema_estado_asignacion). */
export function puedeEditarse(estado: EstadoTema, tieneAsignacionVigente: boolean): boolean {
  return estado !== EstadoTema.ASIGNADO && !tieneAsignacionVigente;
}

const ESTADOS = Object.values(EstadoTema);

/**
 * States accepted by the `estado` + `disponible` filters: undefined = no filter, [] = nothing matches.
 * `disponible` maps to PUBLICADO because TRG_tema_estado_asignacion keeps every topic with a VIGENTE
 * assignment in ASIGNADO, so PUBLICADO already implies "no VIGENTE assignment".
 */
export function filtroEstados(estado?: EstadoTema, disponible?: boolean): EstadoTema[] | undefined {
  if (disponible === true) return estado && estado !== EstadoTema.PUBLICADO ? [] : [EstadoTema.PUBLICADO];
  if (disponible === false) {
    if (estado) return estado === EstadoTema.PUBLICADO ? [] : [estado];
    return ESTADOS.filter((value) => value !== EstadoTema.PUBLICADO);
  }
  return estado ? [estado] : undefined;
}
