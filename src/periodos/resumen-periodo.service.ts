import { HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { ConflictosService } from '../conflictos/conflictos.service.js';
import { CondicionIngreso } from '../habilitados/enums/condicion-ingreso.enum.js';
import { HabilitadoEstado } from '../habilitados/enums/habilitado-estado.enum.js';
import { SituacionIngreso } from '../habilitados/enums/situacion-ingreso.enum.js';
import { EstadoPostulacion } from '../postulaciones/enums/estado-postulacion.enum.js';
import { RevisionPatResultado } from '../revisiones-pat/enums/revision-pat-resultado.enum.js';
import { EstadoTema } from '../temas/enums/estado-tema.enum.js';
import { ResumenPeriodoResponseDto } from './dto/resumen-periodo-response.dto.js';

type Conteo = Record<string, number> | null;
interface ResumenRow {
  existe: boolean;
  estudiantes_habilitados: number;
  condicionados_pendientes: number;
  habilitados_por_estado: Conteo;
  habilitados_por_condicion: Conteo;
  habilitados_por_situacion: Conteo;
  temas_por_estado: Conteo;
  postulaciones_por_estado: Conteo;
  asignaciones_vigentes: number;
  tutores_asignados: number;
  pat_por_estado: Conteo;
}

const ESTADOS_PAT = ['PENDIENTE', ...Object.values(RevisionPatResultado), 'SIN_ENTREGA'];

/** Completa cada clave conocida con 0 y conserva los conteos devueltos por PostgreSQL. */
export function completarConteo(claves: readonly string[], conteo: Conteo): Record<string, number> {
  const base = Object.fromEntries(claves.map((clave) => [clave, 0])) as Record<string, number>;
  for (const [clave, total] of Object.entries(conteo ?? {})) base[clave] = Number(total);
  return base;
}

/** Indicadores agregados del panel administrativo, calculados con una consulta agrupada. */
@Injectable()
export class ResumenPeriodoService {
  constructor(private readonly dataSource: DataSource, private readonly conflictos: ConflictosService) {}

  async obtener(periodoId: string): Promise<ResumenPeriodoResponseDto> {
    let row: ResumenRow | undefined;
    try {
      row = (await this.dataSource.query(this.sql(), [periodoId]) as ResumenRow[])[0];
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('No fue posible calcular el resumen del período.');
    }
    if (!row?.existe) throw new NotFoundException('No existe el período solicitado.');
    const conflictosAbiertos = await this.conflictos.contarSinResolver(periodoId);
    const pat = completarConteo(ESTADOS_PAT, row.pat_por_estado);
    const vigentes = Number(row.asignaciones_vigentes);
    const conTutor = Number(row.tutores_asignados);
    return {
      periodo_id: periodoId,
      estudiantes_habilitados: Number(row.estudiantes_habilitados),
      condicionados_pendientes: Number(row.condicionados_pendientes),
      habilitados_por_estado: completarConteo(Object.values(HabilitadoEstado), row.habilitados_por_estado),
      habilitados_por_condicion: completarConteo(Object.values(CondicionIngreso), row.habilitados_por_condicion),
      habilitados_por_situacion: completarConteo(Object.values(SituacionIngreso), row.habilitados_por_situacion),
      temas_por_estado: completarConteo(Object.values(EstadoTema), row.temas_por_estado),
      postulaciones_por_estado: completarConteo(Object.values(EstadoPostulacion), row.postulaciones_por_estado),
      conflictos_abiertos: conflictosAbiertos,
      asignaciones_vigentes: vigentes,
      tutores_asignados: conTutor,
      sin_tutor: vigentes - conTutor,
      pat_por_revisar: pat.PENDIENTE,
      pat_por_estado: pat,
    };
  }

  private sql(): string {
    const s = this.schema();
    const agrupar = (columna: string, tabla: string) =>
      `(SELECT jsonb_object_agg(x.clave, x.total) FROM (SELECT ${columna}::text AS clave, count(*)::int AS total FROM ${s}."${tabla}" WHERE "periodo_id"=$1 GROUP BY ${columna}) x)`;
    return `SELECT
      EXISTS (SELECT 1 FROM ${s}."periodo_titulacion" WHERE "id"=$1) AS existe,
      (SELECT count(*)::int FROM ${s}."estudiante_habilitado" WHERE "periodo_id"=$1) AS estudiantes_habilitados,
      (SELECT count(*)::int FROM ${s}."estudiante_habilitado" WHERE "periodo_id"=$1 AND "condicion_ingreso"='CONDICIONADO' AND "situacion_ingreso"='PENDIENTE') AS condicionados_pendientes,
      ${agrupar('"estado"', 'estudiante_habilitado')} AS habilitados_por_estado,
      ${agrupar('"condicion_ingreso"', 'estudiante_habilitado')} AS habilitados_por_condicion,
      ${agrupar('"situacion_ingreso"', 'estudiante_habilitado')} AS habilitados_por_situacion,
      ${agrupar('"estado"', 'tema')} AS temas_por_estado,
      ${agrupar('"estado"', 'postulacion')} AS postulaciones_por_estado,
      (SELECT count(*)::int FROM ${s}."asignacion_tema" WHERE "periodo_id"=$1 AND "estado"='VIGENTE') AS asignaciones_vigentes,
      (SELECT count(*)::int FROM ${s}."asignacion_tema" a WHERE a."periodo_id"=$1 AND a."estado"='VIGENTE'
        AND EXISTS (SELECT 1 FROM ${s}."asignacion_tutor" tu WHERE tu."asignacion_tema_id"=a."id" AND tu."estado"='VIGENTE')) AS tutores_asignados,
      (SELECT jsonb_object_agg(x.clave, x.total) FROM (
        SELECT COALESCE(ult."resultado", CASE WHEN ult."id" IS NULL THEN 'SIN_ENTREGA' ELSE 'PENDIENTE' END) AS clave, count(*)::int AS total
        FROM ${s}."asignacion_tema" a
        LEFT JOIN LATERAL (
          SELECT d."id", r."resultado"::text AS resultado FROM ${s}."documento_pat" d
          LEFT JOIN ${s}."revision_pat" r ON r."documento_pat_id"=d."id"
          WHERE d."asignacion_tema_id"=a."id" ORDER BY d."version" DESC LIMIT 1
        ) ult ON true
        WHERE a."periodo_id"=$1 AND a."estado"='VIGENTE'
        GROUP BY 1
      ) x) AS pat_por_estado`;
  }

  private schema(): string {
    const value = (this.dataSource.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new ServiceUnavailableException('El esquema PostgreSQL configurado no es válido.');
    return `"${value}"`;
  }
}
