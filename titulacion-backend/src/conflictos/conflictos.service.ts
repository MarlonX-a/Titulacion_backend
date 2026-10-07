import { ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { EstadoTema } from '../temas/enums/estado-tema.enum.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { Postulacion } from '../postulaciones/entities/postulacion.entity.js';
import { EstadoPostulacion } from '../postulaciones/enums/estado-postulacion.enum.js';
import { Tema } from '../temas/entities/tema.entity.js';
import { CriterioConflicto } from './enums/criterio-conflicto.enum.js';
import { ResolverConflictoDto } from './dto/resolver-conflicto.dto.js';
import { ListConflictosQueryDto, EstadoConsultaConflicto } from './dto/list-conflictos-query.dto.js';
import { ResolucionConflicto } from './entities/resolucion-conflicto.entity.js';
import { ConflictoParticipante } from './entities/conflicto-participante.entity.js';

interface CandidateRow {
  id: string; estado: EstadoPostulacion; grupo_id: string | null; estudiante_id: string | null;
  num_integrantes: number; fecha_postulacion: Date; elegible: boolean; motivo: string | null;
  participantes: Array<{ id: string; nombres: string; apellidos: string; matricula: string }>;
}
interface TopicRow { id: string; titulo: string; estado: EstadoTema; creado_en: Date; min_integrantes: number; max_integrantes: number; resolucion_id: string | null; postulacion_ganadora_id: string | null; criterio_aplicado: CriterioConflicto | null; justificacion: string | null; fecha_resolucion: Date | null; elegibles: string[]; }

@Injectable()
export class ConflictosService {
  constructor(private readonly dataSource: DataSource, private readonly auditoria: AuditoriaService) {}

  async list(periodoId: string, query: ListConflictosQueryDto) {
    try {
      const manager = this.dataSource.manager;
      await this.assertPeriod(manager, periodoId);
      const topics = await this.topicRows(manager, periodoId);
      const filtered = topics.filter((topic) => query.estado === EstadoConsultaConflicto.RESUELTO
        ? topic.resolucion_id !== null
        : query.estado === EstadoConsultaConflicto.SIN_RESOLVER
          ? topic.resolucion_id === null && topic.elegibles.length >= 2
          : topic.resolucion_id !== null || topic.elegibles.length >= 2);
      const start = (query.page - 1) * query.limit;
      return { data: filtered.slice(start, start + query.limit).map((topic) => this.topicResponse(topic)), total: filtered.length, page: query.page, limit: query.limit };
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async detail(periodoId: string, temaId: string) {
    try {
      const manager = this.dataSource.manager;
      await this.assertPeriod(manager, periodoId);
      const topic = await this.topicRow(manager, periodoId, temaId);
      const applications = await this.candidateRows(manager, periodoId, temaId);
      const resolution = await manager.getRepository(ResolucionConflicto).findOne({
        where: { tema: { id: temaId }, periodo: { id: periodoId } }, relations: { resuelto_por: true },
      });
      const participants = resolution ? await manager.getRepository(ConflictoParticipante).find({
        where: { resolucion_conflicto_id: resolution.id }, relations: { postulacion: true }, order: { id: 'ASC' },
      }) : [];
      const result = resolution ? {
        id: resolution.id, criterio_aplicado: resolution.criterio_aplicado,
        postulacion_ganadora_id: resolution.postulacion_ganadora_id,
        justificacion: resolution.justificacion, fecha_resolucion: resolution.fecha_resolucion,
        responsable: { id: resolution.resuelto_por.id, nombres: resolution.resuelto_por.nombres, apellidos: resolution.resuelto_por.apellidos },
        participantes: participants.map((p) => ({ postulacion_id: p.postulacion.id, puntaje_criterio: p.puntaje_criterio === null ? null : Number(p.puntaje_criterio) })),
      } : null;
      return { periodo_id: periodoId, tema: this.topicResponse(topic), elegibles: topic.elegibles.length, resolucion: result, postulaciones: applications.map((item) => ({ id: item.id, estado: item.estado, grupo_id: item.grupo_id, estudiante_id: item.estudiante_id, num_integrantes: item.num_integrantes, fecha_postulacion: item.fecha_postulacion, elegible: item.elegible, motivo: item.motivo, participantes: item.participantes })) };
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async resolve(periodoId: string, temaId: string, dto: ResolverConflictoDto, actor: Usuario, ip: string | null) {
    try {
      await this.dataSource.transaction(async (manager) => {
        const period = await manager.getRepository(PeriodoTitulacion).findOne({ where: { id: periodoId }, lock: { mode: 'pessimistic_write' } });
        if (!period) throw new NotFoundException('No existe el período indicado.');
        if (period.estado !== PeriodoEstado.POSTULACION_CERRADA) throw new ConflictException('Solo se resuelven conflictos con el período en POSTULACION_CERRADA.');
        const topic = await manager.getRepository(Tema).findOne({ where: { id: temaId, periodo: { id: periodoId } }, lock: { mode: 'pessimistic_write' } });
        if (!topic) throw new NotFoundException('No existe el tema en el período indicado.');
        if (topic.estado !== EstadoTema.PUBLICADO) throw new ConflictException('Solo se resuelven conflictos de temas PUBLICADOS.');
        const exists = await manager.getRepository(ResolucionConflicto).findOneBy({ tema: { id: temaId } });
        if (exists) throw new ConflictException('El conflicto de este tema ya tiene una resolución registrada.');

        const inputIds = dto.participantes.map((item) => item.postulacion_id);
        if (new Set(inputIds).size !== inputIds.length) throw new ConflictException('No se pueden repetir postulaciones entre los participantes.');
        await manager.query(`SELECT "id" FROM ${this.schema(manager)}."postulacion" WHERE "periodo_id"=$1 AND "tema_id"=$2 ORDER BY "id" FOR UPDATE`, [periodoId, temaId]);
        const rows = await this.candidateRows(manager, periodoId, temaId);
        const eligible = rows.filter((row) => row.elegible).map((row) => row.id).sort();
        const supplied = [...inputIds].sort();
        if (eligible.length < 2 || eligible.length !== supplied.length || eligible.some((id, index) => id !== supplied[index])) {
          throw new ConflictException('Las postulaciones elegibles cambiaron; consulta nuevamente las candidaturas del conflicto.');
        }
        if (!eligible.includes(dto.postulacion_ganadora_id)) throw new ConflictException('La postulación ganadora debe ser una de las candidaturas elegibles.');
        if (dto.criterio_aplicado === CriterioConflicto.PROMEDIO && dto.participantes.some((item) => item.puntaje_criterio === undefined)) {
          throw new ConflictException('El criterio PROMEDIO requiere puntaje para todos los participantes.');
        }
        const repository = manager.getRepository(ResolucionConflicto);
        const resolution = await repository.save(repository.create({
          tema: { id: temaId } as Tema, periodo: { id: periodoId } as PeriodoTitulacion,
          resuelto_por: actor, criterio_aplicado: dto.criterio_aplicado,
          postulacion_ganadora_id: dto.postulacion_ganadora_id,
          justificacion: dto.justificacion.trim(), fecha_resolucion: new Date(),
        }));
        const participantRepo = manager.getRepository(ConflictoParticipante);
        await participantRepo.insert(dto.participantes.map((item) => ({
          resolucion_conflicto_id: resolution.id, tema_id: temaId,
          postulacion: { id: item.postulacion_id } as Postulacion,
          puntaje_criterio: item.puntaje_criterio === undefined ? null : item.puntaje_criterio.toFixed(2),
        })));
        const before = rows.filter((row) => row.elegible).map((row) => ({ postulacion_id: row.id, fecha_postulacion: row.fecha_postulacion }));
        await this.auditoria.registrar(manager, { actor, accion: 'RESOLVER_CONFLICTO', entidad_tipo: 'resolucion_conflicto', entidad_id: resolution.id, valores_anteriores: null, valores_nuevos: { tema_id: temaId, periodo_id: periodoId, criterio_aplicado: dto.criterio_aplicado, postulacion_ganadora_id: dto.postulacion_ganadora_id, justificacion: dto.justificacion.trim(), participantes: dto.participantes, elegibilidad_comprobada: before }, ip_origen: ip });
      });
      return this.detail(periodoId, temaId);
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  private async topicRows(manager: EntityManager, periodoId: string): Promise<TopicRow[]> {
    const rows = await manager.query(`SELECT t."id",t."titulo",t."estado"::text AS estado,t."creado_en",t."min_integrantes",t."max_integrantes",r."id" AS resolucion_id,r."postulacion_ganadora_id",r."criterio_aplicado"::text AS criterio_aplicado,r."justificacion",r."fecha_resolucion",COALESCE(array_agg(p."id") FILTER (WHERE p."id" IS NOT NULL AND elig."elegible"), ARRAY[]::uuid[]) AS elegibles FROM ${this.schema(manager)}."tema" t LEFT JOIN ${this.schema(manager)}."resolucion_conflicto" r ON r."tema_id"=t."id" LEFT JOIN ${this.schema(manager)}."postulacion" p ON p."tema_id"=t."id" AND p."periodo_id"=t."periodo_id" AND p."estado"='PENDIENTE' LEFT JOIN LATERAL (SELECT ${this.eligibilitySql(manager,'p','t')} AS elegible) elig ON true WHERE t."periodo_id"=$1 GROUP BY t."id",r."id" ORDER BY t."creado_en" DESC,t."id" ASC`, [periodoId]) as TopicRow[];
    return rows;
  }

  private async topicRow(manager: EntityManager, periodoId: string, temaId: string): Promise<TopicRow> {
    const topic = await manager.getRepository(Tema).findOneBy({ id: temaId, periodo: { id: periodoId } });
    if (!topic) throw new NotFoundException('No existe el tema en el período indicado.');
    const rows = await this.topicRows(manager, periodoId);
    const row = rows.find((item) => item.id === temaId);
    if (!row) throw new NotFoundException('No existe el tema en el período indicado.');
    return row;
  }

  private async candidateRows(manager: EntityManager, periodoId: string, temaId: string): Promise<CandidateRow[]> {
    const rows = await manager.query(`SELECT p."id",p."estado"::text AS estado,p."grupo_id",p."estudiante_id",p."num_integrantes",p."fecha_postulacion",${this.eligibilitySql(manager,'p','t')} AS elegible, CASE WHEN p."estado" <> 'PENDIENTE' THEN 'La postulación no está PENDIENTE.' WHEN t."estado" <> 'PUBLICADO' THEN 'El tema no está PUBLICADO.' WHEN p."grupo_id" IS NOT NULL AND g."estado" <> 'ACTIVO' THEN 'El grupo no está ACTIVO.' WHEN p."grupo_id" IS NOT NULL AND members."count" <> p."num_integrantes" THEN 'La composición del grupo cambió.' WHEN NOT ${this.eligibilitySql(manager,'p','t')} THEN 'Uno o más participantes no tienen cuenta y habilitación compatibles, o la cantidad no está dentro del rango del tema.' ELSE NULL END AS motivo, COALESCE(CASE WHEN p."estudiante_id" IS NOT NULL THEN (SELECT jsonb_agg(jsonb_build_object('id',e."id",'nombres',u."nombres",'apellidos',u."apellidos",'matricula',e."matricula")) FROM ${this.schema(manager)}."estudiante" e JOIN ${this.schema(manager)}."usuario" u ON u."id"=e."usuario_id" WHERE e."id"=p."estudiante_id") ELSE (SELECT jsonb_agg(jsonb_build_object('id',e."id",'nombres',u."nombres",'apellidos',u."apellidos",'matricula',e."matricula") ORDER BY gi."fecha_ingreso",gi."id") FROM ${this.schema(manager)}."grupo_integrante" gi JOIN ${this.schema(manager)}."estudiante" e ON e."id"=gi."estudiante_id" JOIN ${this.schema(manager)}."usuario" u ON u."id"=e."usuario_id" WHERE gi."grupo_id"=p."grupo_id" AND gi."estado"='ACTIVO') END,'[]'::jsonb) AS participantes FROM ${this.schema(manager)}."postulacion" p JOIN ${this.schema(manager)}."tema" t ON t."id"=p."tema_id" LEFT JOIN ${this.schema(manager)}."grupo" g ON g."id"=p."grupo_id" LEFT JOIN LATERAL (SELECT count(*)::int AS count FROM ${this.schema(manager)}."grupo_integrante" gi WHERE gi."grupo_id"=p."grupo_id" AND gi."estado"='ACTIVO') members ON true WHERE p."periodo_id"=$1 AND p."tema_id"=$2 ORDER BY p."fecha_postulacion",p."id"`, [periodoId, temaId]) as CandidateRow[];
    return rows;
  }

  private eligibilitySql(manager: EntityManager, p: string, t: string): string {
    const s = this.schema(manager);
    return `(${p}."estado"='PENDIENTE' AND ${t}."estado"='PUBLICADO' AND ${p}."num_integrantes" BETWEEN ${t}."min_integrantes" AND ${t}."max_integrantes" AND CASE WHEN ${p}."estudiante_id" IS NOT NULL THEN ${p}."num_integrantes"=1 AND EXISTS (SELECT 1 FROM ${s}."estudiante_habilitado" h JOIN ${s}."estudiante" e ON e."id"=h."estudiante_id" JOIN ${s}."usuario" u ON u."id"=e."usuario_id" WHERE h."periodo_id"=${p}."periodo_id" AND h."estudiante_id"=${p}."estudiante_id" AND h."estado"='HABILITADO' AND h."situacion_ingreso" IN ('PENDIENTE','ADMITIDO') AND u."estado"='ACTIVO' AND u."rol"='ESTUDIANTE') ELSE EXISTS (SELECT 1 FROM ${s}."grupo" g WHERE g."id"=${p}."grupo_id" AND g."periodo_id"=${p}."periodo_id" AND g."estado"='ACTIVO' AND (SELECT count(*) FROM ${s}."grupo_integrante" gi WHERE gi."grupo_id"=g."id" AND gi."estado"='ACTIVO')=${p}."num_integrantes" AND (SELECT count(*) FROM ${s}."grupo_integrante" gi WHERE gi."grupo_id"=g."id" AND gi."estado"='ACTIVO' AND gi."rol_en_grupo"='REPRESENTANTE')=1 AND NOT EXISTS (SELECT 1 FROM ${s}."grupo_integrante" gi LEFT JOIN ${s}."estudiante_habilitado" h ON h."periodo_id"=gi."periodo_id" AND h."estudiante_id"=gi."estudiante_id" LEFT JOIN ${s}."estudiante" e ON e."id"=gi."estudiante_id" LEFT JOIN ${s}."usuario" u ON u."id"=e."usuario_id" WHERE gi."grupo_id"=g."id" AND gi."estado"='ACTIVO' AND (h."estado" IS DISTINCT FROM 'HABILITADO' OR h."situacion_ingreso" NOT IN ('PENDIENTE','ADMITIDO') OR u."estado" IS DISTINCT FROM 'ACTIVO' OR u."rol" IS DISTINCT FROM 'ESTUDIANTE'))) END)`;
  }

  private topicResponse(row: TopicRow) { return { tema_id: row.id, titulo: row.titulo, estado_tema: row.estado, min_integrantes: Number(row.min_integrantes), max_integrantes: Number(row.max_integrantes), cantidad_postulaciones_elegibles: row.elegibles.length, estado_conflicto: row.resolucion_id ? EstadoConsultaConflicto.RESUELTO : row.elegibles.length >= 2 ? EstadoConsultaConflicto.SIN_RESOLVER : null, resolucion_id: row.resolucion_id, postulacion_ganadora_id: row.postulacion_ganadora_id }; }
  private async assertPeriod(manager: EntityManager, id: string): Promise<void> { if (!await manager.getRepository(PeriodoTitulacion).findOneBy({ id })) throw new NotFoundException('No existe el período indicado.'); }
  private schema(manager: EntityManager): string { const schema = (manager.connection.options as PostgresConnectionOptions).schema ?? 'public'; if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new ServiceUnavailableException('El esquema PostgreSQL configurado no es válido.'); return `"${schema}"`; }
  private handleDatabaseError(error: unknown): never { if (error instanceof HttpException) throw error; if (error instanceof QueryFailedError) { const code = (error.driverError as { code?: string }).code; if (code === '23505') throw new ConflictException('El conflicto ya fue resuelto.'); if (code === '23503' || code === '23514') throw new ConflictException('Las candidaturas no cumplen las reglas de integridad del conflicto.'); } throw new ServiceUnavailableException('No fue posible completar la operación de conflictos en PostgreSQL.'); }
}
