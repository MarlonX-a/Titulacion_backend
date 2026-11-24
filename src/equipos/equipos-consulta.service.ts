import { HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { AsignacionTemaEstado } from '../asignaciones-tema/enums/asignacion-tema-estado.enum.js';
import { AsignacionTemaOrigen } from '../asignaciones-tema/enums/asignacion-tema-origen.enum.js';
import { AsignacionTutorTipo } from '../asignaciones-tutor/enums/asignacion-tutor-tipo.enum.js';
import { CargaTutorialPersistenciaService } from '../carga-tutorial/carga-tutorial-persistencia.service.js';
import { CandidatoTutorDto, EquipoResponseDto, EquipoResumenDto, IntegranteEquipoDto, PagedEquiposResponseDto, TutorVigenteEquipoDto } from './dto/equipo-response.dto.js';
import { ListEquiposQueryDto } from './dto/list-equipos-query.dto.js';

interface FilaEquipo {
  id: string; periodo_id: string; origen: AsignacionTemaOrigen; estado: AsignacionTemaEstado; motivo: string; fecha_asignacion: Date;
  grupo_id: string | null; estudiante_id: string | null;
  tema_id: string; tema_titulo: string; tema_tipo: string; tema_estado: string;
  grupo_nombre: string | null; grupo_estado: string | null;
}

interface FilaIntegrante {
  estudiante_id: string; nombres: string; apellidos: string; matricula: string; rol_en_grupo: string | null; situacion_ingreso: string | null;
  datos_personales: boolean; contenido: boolean;
  generacion_id: string | null; generacion_estado: string | null; generacion_solicitada_en: Date | null;
  documento_id: string | null; documento_version: number | null; documento_fecha: Date | null; revision: string | null;
}

/**
 * Consultas administrativas de equipos. El detalle sirve para cualquier asignación (también las
 * de postulación, sin candidatos) porque la sección PAT por integrante es común; el listado
 * muestra solo los equipos conformados por ADMIN.
 */
@Injectable()
export class EquiposConsultaService {
  constructor(private readonly dataSource: DataSource, private readonly cargaTutorial: CargaTutorialPersistenciaService) {}

  async detalle(periodoId: string, asignacionId: string): Promise<EquipoResponseDto> {
    try {
      const manager = this.dataSource.manager;
      const s = this.schema(manager);
      const [fila] = await manager.query(`
        SELECT a."id",a."periodo_id",a."origen"::text AS origen,a."estado"::text AS estado,a."motivo",a."fecha_asignacion",a."grupo_id",a."estudiante_id",
               t."id" AS tema_id,t."titulo" AS tema_titulo,t."tipo"::text AS tema_tipo,t."estado"::text AS tema_estado,
               g."nombre" AS grupo_nombre,g."estado"::text AS grupo_estado
        FROM ${s}."asignacion_tema" a JOIN ${s}."tema" t ON t."id"=a."tema_id" LEFT JOIN ${s}."grupo" g ON g."id"=a."grupo_id"
        WHERE a."id"=$1 AND a."periodo_id"=$2`, [asignacionId, periodoId]) as FilaEquipo[];
      if (!fila) throw new NotFoundException('No existe ese equipo en el período indicado.');
      const [integrantes, candidatos, tutor] = await Promise.all([this.integrantes(manager, fila), this.candidatos(manager, fila), this.tutorVigente(manager, fila.id)]);
      return {
        id: fila.id, periodo_id: fila.periodo_id, origen: fila.origen, estado: fila.estado, modalidad: fila.grupo_id ? 'GRUPAL' : 'INDIVIDUAL',
        motivo: fila.motivo, fecha_asignacion: fila.fecha_asignacion,
        tema: { id: fila.tema_id, titulo: fila.tema_titulo, tipo: fila.tema_tipo, estado: fila.tema_estado },
        grupo: fila.grupo_id ? { id: fila.grupo_id, nombre: fila.grupo_nombre ?? '', estado: fila.grupo_estado ?? '' } : null,
        integrantes, candidatos, tutor_vigente: tutor,
      };
    } catch (error: unknown) { this.manejarError(error); }
  }

  async listar(periodoId: string, query: ListEquiposQueryDto): Promise<PagedEquiposResponseDto> {
    try {
      const manager = this.dataSource.manager;
      const s = this.schema(manager);
      const existe = await manager.query(`SELECT 1 FROM ${s}."periodo_titulacion" WHERE "id"=$1`, [periodoId]) as unknown[];
      if (!existe.length) throw new NotFoundException('No existe el período indicado.');
      const filtros = [periodoId, query.estado ?? null];
      const where = `a."periodo_id"=$1 AND a."origen"='ADMIN' AND ($2::text IS NULL OR a."estado"::text=$2)`;
      const [{ total }] = await manager.query(`SELECT count(*)::int AS total FROM ${s}."asignacion_tema" a WHERE ${where}`, filtros) as [{ total: number }];
      const filas = await manager.query(`
        SELECT a."id",a."estado"::text AS estado,a."fecha_asignacion",a."grupo_id",a."estudiante_id",t."id" AS tema_id,t."titulo" AS tema_titulo,g."nombre" AS grupo_nombre,
               (SELECT count(*)::int FROM ${s}."candidato_tutor" c WHERE c."asignacion_tema_id"=a."id") AS total_candidatos,
               tutor."docente_id" AS tutor_docente_id,tu."nombres" AS tutor_nombres,tu."apellidos" AS tutor_apellidos
        FROM ${s}."asignacion_tema" a JOIN ${s}."tema" t ON t."id"=a."tema_id" LEFT JOIN ${s}."grupo" g ON g."id"=a."grupo_id"
        LEFT JOIN ${s}."asignacion_tutor" tutor ON tutor."asignacion_tema_id"=a."id" AND tutor."estado"='VIGENTE'
        LEFT JOIN ${s}."docente" d ON d."id"=tutor."docente_id" LEFT JOIN ${s}."usuario" tu ON tu."id"=d."usuario_id"
        WHERE ${where}
        ORDER BY a."fecha_asignacion" DESC,a."id" ASC LIMIT $3 OFFSET $4`, [...filtros, query.limit, (query.page - 1) * query.limit]) as Array<{
          id: string; estado: AsignacionTemaEstado; fecha_asignacion: Date; grupo_id: string | null; estudiante_id: string | null; tema_id: string; tema_titulo: string;
          grupo_nombre: string | null; total_candidatos: number; tutor_docente_id: string | null; tutor_nombres: string | null; tutor_apellidos: string | null;
        }>;
      const personas = filas.length ? await manager.query(`
        SELECT a."id" AS asignacion_id,e."id" AS estudiante_id,u."nombres",u."apellidos"
        FROM ${s}."asignacion_tema" a
        JOIN ${s}."estudiante" e ON e."id"=a."estudiante_id" OR EXISTS (SELECT 1 FROM ${s}."grupo_integrante" gi WHERE gi."grupo_id"=a."grupo_id" AND gi."estudiante_id"=e."id" AND gi."estado"='ACTIVO')
        JOIN ${s}."usuario" u ON u."id"=e."usuario_id"
        WHERE a."id"=ANY($1::uuid[]) ORDER BY u."apellidos",u."nombres",e."id"`, [filas.map((fila) => fila.id)]) as Array<{ asignacion_id: string; estudiante_id: string; nombres: string; apellidos: string }> : [];
      const data: EquipoResumenDto[] = filas.map((fila) => ({
        id: fila.id, estado: fila.estado, modalidad: fila.grupo_id ? 'GRUPAL' : 'INDIVIDUAL', fecha_asignacion: fila.fecha_asignacion,
        tema: { id: fila.tema_id, titulo: fila.tema_titulo },
        grupo: fila.grupo_id ? { id: fila.grupo_id, nombre: fila.grupo_nombre ?? '' } : null,
        integrantes: personas.filter((p) => p.asignacion_id === fila.id).map((p) => ({ estudiante_id: p.estudiante_id, nombres: p.nombres, apellidos: p.apellidos })),
        total_candidatos: Number(fila.total_candidatos),
        tutor_vigente: fila.tutor_docente_id ? { docente_id: fila.tutor_docente_id, nombres: fila.tutor_nombres ?? '', apellidos: fila.tutor_apellidos ?? '' } : null,
      }));
      return { data, total: Number(total), page: query.page, limit: query.limit };
    } catch (error: unknown) { this.manejarError(error); }
  }

  /** Integrantes ACTIVOS (o el titular) con su estado PAT individual en este trabajo. */
  private async integrantes(manager: EntityManager, fila: FilaEquipo): Promise<IntegranteEquipoDto[]> {
    const s = this.schema(manager);
    const filas = await manager.query(`
      WITH participante AS (
        SELECT e."id",NULL::text AS rol_en_grupo FROM ${s}."estudiante" e WHERE $2::uuid IS NOT NULL AND e."id"=$2
        UNION ALL
        SELECT gi."estudiante_id",gi."rol_en_grupo"::text FROM ${s}."grupo_integrante" gi WHERE $3::uuid IS NOT NULL AND gi."grupo_id"=$3 AND gi."estado"='ACTIVO'
      )
      SELECT e."id" AS estudiante_id,u."nombres",u."apellidos",e."matricula",p.rol_en_grupo,h."situacion_ingreso"::text AS situacion_ingreso,
             EXISTS (SELECT 1 FROM ${s}."estudiante_datos_pat" dp WHERE dp."estudiante_id"=e."id") AS datos_personales,
             EXISTS (SELECT 1 FROM ${s}."contenido_pat_estudiante" cp WHERE cp."estudiante_id"=e."id" AND cp."asignacion_tema_id"=$1) AS contenido,
             gen."id" AS generacion_id,gen."estado" AS generacion_estado,gen."solicitada_en" AS generacion_solicitada_en,
             doc."id" AS documento_id,doc."version" AS documento_version,doc."fecha_carga" AS documento_fecha,doc."revision"
      FROM participante p JOIN ${s}."estudiante" e ON e."id"=p."id" JOIN ${s}."usuario" u ON u."id"=e."usuario_id"
      LEFT JOIN ${s}."estudiante_habilitado" h ON h."periodo_id"=$4 AND h."estudiante_id"=e."id"
      LEFT JOIN LATERAL (SELECT g."id",g."estado",g."solicitada_en" FROM ${s}."generacion_pat" g WHERE g."asignacion_tema_id"=$1 AND g."estudiante_id"=e."id" ORDER BY g."solicitada_en" DESC,g."id" DESC LIMIT 1) gen ON true
      LEFT JOIN LATERAL (SELECT d."id",d."version",d."fecha_carga",r."resultado"::text AS revision FROM ${s}."documento_pat" d LEFT JOIN ${s}."revision_pat" r ON r."documento_pat_id"=d."id" WHERE d."asignacion_tema_id"=$1 AND d."estudiante_id"=e."id" ORDER BY d."version" DESC LIMIT 1) doc ON true
      ORDER BY (p.rol_en_grupo='REPRESENTANTE') DESC NULLS LAST,u."apellidos",u."nombres",e."id"`, [fila.id, fila.estudiante_id, fila.grupo_id, fila.periodo_id]) as FilaIntegrante[];
    return filas.map((row) => ({
      estudiante_id: row.estudiante_id, nombres: row.nombres, apellidos: row.apellidos, matricula: row.matricula, rol_en_grupo: row.rol_en_grupo, situacion_ingreso: row.situacion_ingreso,
      pat: {
        datos_personales_registrados: Boolean(row.datos_personales), contenido_registrado: Boolean(row.contenido),
        ultima_generacion: row.generacion_id ? { id: row.generacion_id, estado: row.generacion_estado ?? '', solicitada_en: row.generacion_solicitada_en! } : null,
        ultima_entrega: row.documento_id ? { id: row.documento_id, version: Number(row.documento_version), fecha_carga: row.documento_fecha!, revision: row.revision } : null,
      },
    }));
  }

  private async candidatos(manager: EntityManager, fila: FilaEquipo): Promise<CandidatoTutorDto[]> {
    const s = this.schema(manager);
    const filas = await manager.query(`
      SELECT c."id",c."prioridad",d."id" AS docente_id,u."nombres",u."apellidos",d."titulo_academico",
             (d."habilitado_tutoria" AND u."estado"='ACTIVO' AND u."rol"='DOCENTE') AS elegible
      FROM ${s}."candidato_tutor" c JOIN ${s}."docente" d ON d."id"=c."docente_id" JOIN ${s}."usuario" u ON u."id"=d."usuario_id"
      WHERE c."asignacion_tema_id"=$1 ORDER BY c."prioridad"`, [fila.id]) as Array<{ id: string; prioridad: number; docente_id: string; nombres: string; apellidos: string; titulo_academico: string | null; elegible: boolean }>;
    const cargas = await this.cargaTutorial.resumirCargaDocentes(manager, fila.periodo_id, filas.map((row) => row.docente_id));
    return filas.map((row) => {
      const carga = cargas.get(row.docente_id);
      return {
        id: row.id, prioridad: Number(row.prioridad), elegible_actualmente: Boolean(row.elegible),
        docente: { id: row.docente_id, nombres: row.nombres, apellidos: row.apellidos, titulo_academico: row.titulo_academico },
        carga: { actual: carga?.actual ?? 0, max_trabajos: carga?.configuracion?.max_trabajos ?? null, bloquear_al_superar: carga?.configuracion?.bloquear_al_superar ?? null },
      };
    });
  }

  private async tutorVigente(manager: EntityManager, asignacionId: string): Promise<TutorVigenteEquipoDto | null> {
    const s = this.schema(manager);
    const [row] = await manager.query(`
      SELECT tutor."id",tutor."tipo"::text AS tipo,tutor."candidato_tutor_id",tutor."fecha_asignacion",d."id" AS docente_id,u."nombres",u."apellidos",d."titulo_academico"
      FROM ${s}."asignacion_tutor" tutor JOIN ${s}."docente" d ON d."id"=tutor."docente_id" JOIN ${s}."usuario" u ON u."id"=d."usuario_id"
      WHERE tutor."asignacion_tema_id"=$1 AND tutor."estado"='VIGENTE'`, [asignacionId]) as Array<{ id: string; tipo: AsignacionTutorTipo; candidato_tutor_id: string | null; fecha_asignacion: Date; docente_id: string; nombres: string; apellidos: string; titulo_academico: string | null }>;
    if (!row) return null;
    return { id: row.id, tipo: row.tipo, candidato_tutor_id: row.candidato_tutor_id, fecha_asignacion: row.fecha_asignacion, docente: { id: row.docente_id, nombres: row.nombres, apellidos: row.apellidos, titulo_academico: row.titulo_academico } };
  }

  private schema(manager: EntityManager): string {
    const value = (manager.connection.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new ServiceUnavailableException('El esquema PostgreSQL configurado no es válido.');
    return `"${value}"`;
  }

  private manejarError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException('No se pudo consultar los equipos en PostgreSQL.', { cause: error });
  }
}
