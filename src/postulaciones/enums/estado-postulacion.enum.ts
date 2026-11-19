export enum EstadoPostulacion {
  PENDIENTE = 'PENDIENTE',
  EN_CONFLICTO = 'EN_CONFLICTO',
  ACEPTADA = 'ACEPTADA',
  RECHAZADA = 'RECHAZADA',
  CANCELADA = 'CANCELADA',
  ANULADA = 'ANULADA',
  /** Postulación grupal registrada por el representante, a la espera de que todos los integrantes confirmen. */
  PENDIENTE_CONFIRMACION = 'PENDIENTE_CONFIRMACION',
}
