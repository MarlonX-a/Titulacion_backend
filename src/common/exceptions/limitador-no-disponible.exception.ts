import { ServiceUnavailableException } from '@nestjs/common';

/**
 * 503 del limitador de solicitudes (autenticación, `@RateLimit` y cupos de subida) cuando Redis no
 * responde. La respuesta HTTP es la misma que la de `ServiceUnavailableException`; la clase propia
 * permite reconocer el caso sin comparar mensajes. El limitador ya registra el fallo de Redis como
 * máximo una vez cada 30 s, por lo que el filtro de errores no lo vuelve a registrar por solicitud.
 */
export class LimitadorNoDisponibleException extends ServiceUnavailableException {
  constructor(cause: unknown) {
    super('El servicio de autenticación no está disponible.', { cause });
  }
}
