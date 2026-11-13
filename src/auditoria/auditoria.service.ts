import { isIP } from 'node:net';
import { Injectable, Optional } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Auditoria } from './entities/auditoria.entity.js';
import { SENSITIVE_KEY } from './auditoria-consulta.service.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';

export interface AuditoriaInput {
  /**
   * Usuario responsable. `null` solo para acciones automáticas del sistema, que deben incluir
   * `valores_nuevos.automatico = true` (lo exige `CHK_auditoria_actor_o_automatico`).
   */
  actor: Usuario | null;
  accion: string;
  entidad_tipo: string;
  entidad_id: string;
  valores_anteriores: Record<string, unknown> | null;
  valores_nuevos: Record<string, unknown> | null;
  ip_origen: string | null;
}

/** Eventos de seguridad de la autenticación (diseño S1, §6). */
export const EVENTOS_SEGURIDAD = [
  'LOGIN_EXITOSO',
  'LOGIN_FALLIDO',
  'LOGIN_BLOQUEADO',
  'FUERZA_BRUTA_SOSPECHADA',
  'PRIMER_ACCESO',
  'PRIMER_ACCESO_MASIVO',
  'CAMBIO_CLAVE',
  'RECUPERACION_SOLICITADA',
  'RECUPERACION_COMPLETADA',
  'SESION_REUSO_DETECTADO',
  'SESION_INACTIVA',
  'LOGOUT',
] as const;

export type EventoSeguridad = (typeof EVENTOS_SEGURIDAD)[number];

export interface EventoSeguridadInput {
  /** Cuenta afectada; `null` si el evento no corresponde a una cuenta existente. */
  usuarioId: string | null;
  ip: string | null;
  /** Contexto adicional. Se descartan las claves de credenciales, hashes, códigos y tokens. */
  detalles?: Record<string, unknown>;
}

/** Entidad de los eventos sin cuenta asociada (`entidad_id` es UUID obligatorio). */
export const ENTIDAD_SEGURIDAD_SIN_CUENTA = '00000000-0000-0000-0000-000000000000';
/** Además de la lista de la consulta, un evento de seguridad nunca guarda hashes ni códigos. */
const CLAVE_PROHIBIDA_EVENTO = /hash|digest|c[oó]digo|code|automatico/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Copia `detalles` sin las claves sensibles, a cualquier profundidad. */
function detallesSeguros(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(detallesSeguros);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_KEY.test(key) && !CLAVE_PROHIBIDA_EVENTO.test(key))
      .map(([key, item]) => [key, detallesSeguros(item)]));
  }
  return value;
}

@Injectable()
export class AuditoriaService {
  constructor(@Optional() private readonly dataSource?: DataSource) {}

  async registrar(manager: EntityManager, input: AuditoriaInput): Promise<void> {
    if (input.actor === null && input.valores_nuevos?.['automatico'] !== true) {
      throw new Error('Una auditoría sin usuario solo se permite para acciones automáticas.');
    }
    const repository = manager.getRepository(Auditoria);
    await repository.save(repository.create({
      usuario: input.actor,
      accion: input.accion,
      entidad_tipo: input.entidad_tipo,
      entidad_id: input.entidad_id,
      valores_anteriores: input.valores_anteriores,
      valores_nuevos: input.valores_nuevos,
      ip_origen: input.ip_origen,
      fecha_hora: new Date(),
    }));
  }

  /**
   * Registra un evento de seguridad como acción del sistema: sin actor y con
   * `valores_nuevos.automatico = true` (dentro de `CHK_auditoria_actor_o_automatico`), sobre la
   * entidad `usuario` afectada. Con `manager` se une a esa transacción; con `null` se inserta
   * por separado, para que el evento quede aunque la operación que lo origina falle.
   */
  async registrarEventoSeguridad(manager: EntityManager | null, evento: EventoSeguridad, input: EventoSeguridadInput): Promise<void> {
    if (!(EVENTOS_SEGURIDAD as readonly string[]).includes(evento)) throw new Error('Evento de seguridad desconocido.');
    if (input.usuarioId !== null && !UUID.test(input.usuarioId)) throw new Error('El usuario del evento de seguridad no es válido.');
    const target = manager ?? this.dataSource?.manager;
    if (!target) throw new Error('No hay conexión disponible para registrar el evento de seguridad.');
    await this.registrar(target, {
      actor: null,
      accion: evento,
      entidad_tipo: input.usuarioId === null ? 'seguridad' : 'usuario',
      entidad_id: input.usuarioId ?? ENTIDAD_SEGURIDAD_SIN_CUENTA,
      valores_anteriores: null,
      valores_nuevos: { ...(detallesSeguros(input.detalles ?? {}) as Record<string, unknown>), automatico: true },
      ip_origen: input.ip !== null && isIP(input.ip) !== 0 ? input.ip : null,
    });
  }
}
