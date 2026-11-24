import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { SituacionIngreso } from '../habilitados/enums/situacion-ingreso.enum.js';

/**
 * Estados del período en que ADMIN conforma equipos: con la postulación cerrada (no compite con
 * postulaciones en curso) y durante la titulación. Coinciden con los estados en que
 * `proteger_asignacion_tutor` admite asignar el tutor vigente.
 */
export const ESTADOS_PERIODO_EQUIPOS: readonly PeriodoEstado[] = [PeriodoEstado.POSTULACION_CERRADA, PeriodoEstado.EN_CURSO];

export function periodoAdmiteEquipos(estado: PeriodoEstado): boolean {
  return ESTADOS_PERIODO_EQUIPOS.includes(estado);
}

/**
 * Misma regla que la asignación desde postulación: ADMITIDO siempre; un condicionado PENDIENTE
 * solo antes del inicio de titulación.
 */
export function situacionAdmiteAsignacion(situacion: SituacionIngreso, ahora: Date, inicioTitulacion: Date): boolean {
  return situacion === SituacionIngreso.ADMITIDO || (situacion === SituacionIngreso.PENDIENTE && ahora < inicioTitulacion);
}

const MAX_NOMBRE_GRUPO = 120;

/** Nombre por defecto del grupo: «Equipo — <título del tema>», recortado a 120 caracteres. */
export function nombreGrupoPorDefecto(tituloTema: string): string {
  const nombre = `Equipo — ${tituloTema.trim().replace(/\s+/g, ' ')}`;
  return nombre.length <= MAX_NOMBRE_GRUPO ? nombre : `${nombre.slice(0, MAX_NOMBRE_GRUPO - 1).trimEnd()}…`;
}

/** Nombre visible de una persona para los mensajes de error («Apellidos, Nombres»). */
export function nombrePersona(persona: { nombres: string; apellidos: string }): string {
  return `${persona.apellidos} ${persona.nombres}`.trim();
}
