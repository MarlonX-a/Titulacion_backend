import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';

/** Horas que tienen los integrantes para confirmar una postulación antes de que la reserva venza. */
export const RESERVA_CONFIRMACION_HORAS = 48;

const HORA_MS = 3_600_000;

/** Instante en que vence la reserva de una postulación PENDIENTE_CONFIRMACION. */
export function venceEn(fechaPostulacion: Date): Date {
  return new Date(fechaPostulacion.getTime() + RESERVA_CONFIRMACION_HORAS * HORA_MS);
}

/** Límite inferior de `fecha_postulacion` para que una reserva siga vigente en `ahora`. */
export function limiteVigencia(ahora: Date): Date {
  return new Date(ahora.getTime() - RESERVA_CONFIRMACION_HORAS * HORA_MS);
}

export const MOTIVO_VENCIDA_PLAZO = `Reserva vencida: no todos los integrantes confirmaron en ${RESERVA_CONFIRMACION_HORAS} horas.`;
export const MOTIVO_VENCIDA_CIERRE = 'Reserva vencida: cerró el plazo de postulación sin la confirmación de todos los integrantes.';

interface PeriodoPlazo { estado: PeriodoEstado; fecha_fin_postulacion: Date }

/**
 * Motivo por el que la reserva de una postulación PENDIENTE_CONFIRMACION ya venció, o `null` si
 * sigue vigente: 48 horas desde su registro o fin del plazo de postulación del período.
 */
export function motivoReservaVencida(fechaPostulacion: Date, periodo: PeriodoPlazo, ahora: Date): string | null {
  if (ahora.getTime() >= venceEn(fechaPostulacion).getTime()) return MOTIVO_VENCIDA_PLAZO;
  if (periodo.estado !== PeriodoEstado.POSTULACION_ABIERTA || ahora.getTime() >= periodo.fecha_fin_postulacion.getTime()) return MOTIVO_VENCIDA_CIERRE;
  return null;
}
