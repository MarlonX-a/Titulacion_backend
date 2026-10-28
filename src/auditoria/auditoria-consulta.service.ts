import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import type { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import type { AuditoriaPageDto, AuditoriaResponseDto } from './dto/auditoria-response.dto.js';
import type { ListAuditoriaQueryDto } from './dto/list-auditoria-query.dto.js';

interface AuditoriaRow {
  id: string;
  accion: string;
  entidad_tipo: string;
  entidad_id: string;
  valores_anteriores: Record<string, unknown> | null;
  valores_nuevos: Record<string, unknown> | null;
  ip_origen: string | null;
  fecha_hora: Date;
  actor_id: string;
  actor_email: string;
  actor_nombres: string;
  actor_apellidos: string;
  actor_rol: UsuarioRol;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Claves que nunca se muestran aunque una auditoría futura las incluyera por error. */
const SENSITIVE_KEY = /pass|contrasena|contraseña|token|secret|clave|credencial|csrf|cookie/i;

/** Escapa los comodines de ILIKE para buscar el texto literal (con ESCAPE '\'). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** Oculta recursivamente los valores de claves sensibles como defensa en profundidad. */
export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? '[REDACTADO]' : redactSensitive(item)]));
  }
  return value;
}

interface RangoFechas { desde: Date | null; hasta: Date | null; hastaExclusivo: boolean }

function rangoFechas(query: ListAuditoriaQueryDto): RangoFechas {
  const desde = query.desde ? new Date(query.desde) : null;
  const hastaExclusivo = Boolean(query.hasta && DATE_ONLY.test(query.hasta));
  const hasta = !query.hasta ? null
    : hastaExclusivo ? new Date(Date.parse(`${query.hasta}T00:00:00Z`) + DAY_MS) : new Date(query.hasta);
  if ((desde && Number.isNaN(desde.getTime())) || (hasta && Number.isNaN(hasta.getTime()))) {
    throw new BadRequestException('Las fechas deben ser ISO 8601 válidas.');
  }
  if (desde && hasta && (hastaExclusivo ? desde >= hasta : desde > hasta)) {
    throw new BadRequestException('La fecha desde debe ser anterior o igual a la fecha hasta.');
  }
  return { desde, hasta, hastaExclusivo };
}

/** Consulta de solo lectura del registro de auditoría funcional para ADMIN. */
@Injectable()
export class AuditoriaConsultaService {
  constructor(private readonly dataSource: DataSource) {}

  async listar(query: ListAuditoriaQueryDto): Promise<AuditoriaPageDto> {
    const { desde, hasta, hastaExclusivo } = rangoFechas(query);
    const conditions: string[] = [];
    const params: unknown[] = [];
    const add = (sql: (placeholder: string) => string, value: unknown) => {
      params.push(value);
      conditions.push(sql(`$${params.length}`));
    };
    if (query.entidad_tipo) add((p) => `a."entidad_tipo" = ${p}`, query.entidad_tipo);
    if (query.entidad_id) add((p) => `a."entidad_id" = ${p}::uuid`, query.entidad_id);
    if (query.accion) add((p) => `a."accion" = ${p}`, query.accion);
    if (query.usuario_id) add((p) => `a."usuario_id" = ${p}::uuid`, query.usuario_id);
    if (desde) add((p) => `a."fecha_hora" >= ${p}::timestamptz`, desde);
    if (hasta) add((p) => `a."fecha_hora" ${hastaExclusivo ? '<' : '<='} ${p}::timestamptz`, hasta);
    if (query.q) {
      add((p) => `(a."accion" ILIKE ${p} ESCAPE '\\' OR a."entidad_tipo" ILIKE ${p} ESCAPE '\\' OR u."email" ILIKE ${p} ESCAPE '\\')`, `%${escapeLike(query.q)}%`);
    }

    const s = this.schema();
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const from = `FROM ${s}."auditoria" a JOIN ${s}."usuario" u ON u."id" = a."usuario_id"${where}`;
    try {
      const counted = await this.dataSource.query(`SELECT count(*)::int AS total ${from}`, params) as Array<{ total: number | string }>;
      const rows = await this.dataSource.query(
        `SELECT a."id"::text AS id, a."accion", a."entidad_tipo", a."entidad_id", a."valores_anteriores", a."valores_nuevos", host(a."ip_origen") AS ip_origen, a."fecha_hora", u."id" AS actor_id, u."email" AS actor_email, u."nombres" AS actor_nombres, u."apellidos" AS actor_apellidos, u."rol"::text AS actor_rol ${from} ORDER BY a."fecha_hora" DESC, a."id" DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.limit, (query.page - 1) * query.limit],
      ) as AuditoriaRow[];
      return { data: rows.map(toResponse), total: Number(counted[0]?.total ?? 0), page: query.page, limit: query.limit };
    } catch (error: unknown) {
      if (error instanceof QueryFailedError) throw new ServiceUnavailableException('No fue posible consultar la auditoría.');
      throw error;
    }
  }

  private schema(): string {
    const value = (this.dataSource.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new ServiceUnavailableException('El esquema PostgreSQL configurado no es válido.');
    return `"${value}"`;
  }
}

function toResponse(row: AuditoriaRow): AuditoriaResponseDto {
  return {
    id: String(row.id),
    actor: { id: row.actor_id, email: row.actor_email, nombres: row.actor_nombres, apellidos: row.actor_apellidos, rol: row.actor_rol },
    accion: row.accion,
    entidad_tipo: row.entidad_tipo,
    entidad_id: row.entidad_id,
    valores_anteriores: redactSensitive(row.valores_anteriores) as Record<string, unknown> | null,
    valores_nuevos: redactSensitive(row.valores_nuevos) as Record<string, unknown> | null,
    ip_origen: row.ip_origen,
    fecha_hora: row.fecha_hora,
  };
}
