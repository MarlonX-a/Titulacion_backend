export enum EstadoTema {
  BORRADOR = 'BORRADOR',
  PUBLICADO = 'PUBLICADO',
  CERRADO = 'CERRADO',
  ASIGNADO = 'ASIGNADO',
  RETIRADO = 'RETIRADO',
  /** Reservado por una postulación PENDIENTE_CONFIRMACION o PENDIENTE; vuelve a PUBLICADO al liberarse. */
  RESERVADO = 'RESERVADO',
}
