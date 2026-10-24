import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { ExportacionTipo } from '../exportaciones/enums/exportacion-tipo.enum.js';

export interface ReporteDatos { columnas: string[]; filas: Record<string, unknown>[] }

@Injectable()
export class ReportesService {
  constructor(private readonly dataSource: DataSource) {}

  async generar(manager: EntityManager, periodoId: string, tipo: ExportacionTipo, filtros: Record<string, unknown>): Promise<ReporteDatos> {
    const s = this.schema(manager);
    const params: unknown[] = tipo === ExportacionTipo.DOCENTES ? [] : [periodoId];
    const add = (value: unknown): string => { params.push(value); return `$${params.length}`; };
    let sql: string;
    let columnas: string[];
    switch (tipo) {
      case ExportacionTipo.ESTUDIANTES: {
        const conditions = [`eh."periodo_id"=$1`];
        if (filtros.estado) conditions.push(`eh."estado"=${add(filtros.estado)}`);
        if (filtros.condicion_ingreso) conditions.push(`eh."condicion_ingreso"=${add(filtros.condicion_ingreso)}`);
        if (filtros.situacion_ingreso) conditions.push(`eh."situacion_ingreso"=${add(filtros.situacion_ingreso)}`);
        sql = `SELECT e."matricula" AS "Matrícula", u."nombres" AS "Nombres", u."apellidos" AS "Apellidos", e."carrera" AS "Carrera", e."nivel" AS "Nivel", eh."estado" AS "Estado de habilitación", eh."condicion_ingreso" AS "Condición", eh."situacion_ingreso" AS "Situación de ingreso" FROM ${s}."estudiante_habilitado" eh JOIN ${s}."estudiante" e ON e."id"=eh."estudiante_id" JOIN ${s}."usuario" u ON u."id"=e."usuario_id" WHERE ${conditions.join(' AND ')} ORDER BY e."id"`;
        columnas = ['Matrícula','Nombres','Apellidos','Carrera','Nivel','Estado de habilitación','Condición','Situación de ingreso']; break;
      }
      case ExportacionTipo.GRUPOS: {
        const conditions = [`g."periodo_id"=$1`];
        if (filtros.estado) conditions.push(`g."estado"=${add(filtros.estado)}`);
        sql = `SELECT g."id" AS "ID de grupo", g."nombre" AS "Grupo", g."estado" AS "Estado", u."nombres" AS "Nombres", u."apellidos" AS "Apellidos", e."matricula" AS "Matrícula", gi."rol_en_grupo" AS "Rol", gi."estado" AS "Estado de pertenencia", gi."fecha_ingreso" AS "Fecha de ingreso", gi."fecha_salida" AS "Fecha de salida" FROM ${s}."grupo" g LEFT JOIN ${s}."grupo_integrante" gi ON gi."grupo_id"=g."id" LEFT JOIN ${s}."estudiante" e ON e."id"=gi."estudiante_id" LEFT JOIN ${s}."usuario" u ON u."id"=e."usuario_id" WHERE ${conditions.join(' AND ')} ORDER BY g."id", gi."fecha_ingreso", gi."id"`;
        columnas = ['ID de grupo','Grupo','Estado','Nombres','Apellidos','Matrícula','Rol','Estado de pertenencia','Fecha de ingreso','Fecha de salida']; break;
      }
      case ExportacionTipo.TEMAS_OFERTADOS:
      case ExportacionTipo.TEMAS_DISPONIBLES: {
        const conditions = [`t."periodo_id"=$1`];
        if (tipo === ExportacionTipo.TEMAS_DISPONIBLES) conditions.push(`t."estado"='PUBLICADO'`, `NOT EXISTS (SELECT 1 FROM ${s}."asignacion_tema" atv WHERE atv."tema_id"=t."id" AND atv."estado"='VIGENTE')`);
        else conditions.push(`EXISTS (SELECT 1 FROM ${s}."tema_historial" th WHERE th."tema_id"=t."id" AND th."estado_nuevo"='PUBLICADO')`);
        if (filtros.estado && tipo === ExportacionTipo.TEMAS_OFERTADOS) conditions.push(`t."estado"=${add(filtros.estado)}`);
        if (filtros.linea_id) conditions.push(`t."linea_id"=${add(filtros.linea_id)}`);
        if (filtros.docente_proponente_id) conditions.push(`t."docente_proponente_id"=${add(filtros.docente_proponente_id)}`);
        sql = `SELECT t."id" AS "Tema", t."titulo" AS "Título", t."descripcion" AS "Descripción", t."estado" AS "Estado", t."min_integrantes" AS "Mínimo de integrantes", t."max_integrantes" AS "Máximo de integrantes", l."codigo" AS "Código de línea", l."nombre" AS "Línea", u."nombres" AS "Nombres del proponente", u."apellidos" AS "Apellidos del proponente" FROM ${s}."tema" t JOIN ${s}."linea_investigacion" l ON l."id"=t."linea_id" JOIN ${s}."docente" d ON d."id"=t."docente_proponente_id" JOIN ${s}."usuario" u ON u."id"=d."usuario_id" WHERE ${conditions.join(' AND ')} ORDER BY t."id"`;
        columnas = ['Tema','Título','Descripción','Estado','Mínimo de integrantes','Máximo de integrantes','Código de línea','Línea','Nombres del proponente','Apellidos del proponente']; break;
      }
      case ExportacionTipo.TEMAS_ASIGNADOS: {
        const conditions = [`a."periodo_id"=$1`];
        if (filtros.estado) conditions.push(`a."estado"=${add(filtros.estado)}`);
        if (filtros.modalidad) conditions.push(filtros.modalidad === 'GRUPAL' ? 'a."grupo_id" IS NOT NULL' : 'a."estudiante_id" IS NOT NULL');
        sql = `SELECT a."id" AS "Asignación", a."estado" AS "Estado de asignación", a."fecha_asignacion" AS "Fecha", t."titulo" AS "Tema", CASE WHEN a."grupo_id" IS NOT NULL THEN 'GRUPAL' ELSE 'INDIVIDUAL' END AS "Modalidad", COALESCE(g."nombre", concat_ws(' ', us."nombres", us."apellidos")) AS "Titular", COALESCE(participantes."nombres", concat_ws(' ', us."nombres", us."apellidos")) AS "Participantes", tutor."nombres" AS "Nombres del tutor", tutor."apellidos" AS "Apellidos del tutor", COALESCE(pat."revision",'SIN_ENTREGA') AS "Situación PAT" FROM ${s}."asignacion_tema" a JOIN ${s}."tema" t ON t."id"=a."tema_id" LEFT JOIN ${s}."grupo" g ON g."id"=a."grupo_id" LEFT JOIN ${s}."estudiante" e ON e."id"=a."estudiante_id" LEFT JOIN ${s}."usuario" us ON us."id"=e."usuario_id" LEFT JOIN LATERAL (SELECT string_agg(concat_ws(' ',u."nombres",u."apellidos"), ', ' ORDER BY gi."id") AS "nombres" FROM ${s}."grupo_integrante" gi JOIN ${s}."estudiante" ge ON ge."id"=gi."estudiante_id" JOIN ${s}."usuario" u ON u."id"=ge."usuario_id" WHERE gi."grupo_id"=a."grupo_id" AND gi."estado"='ACTIVO') participantes ON true LEFT JOIN LATERAL (SELECT ut."nombres",ut."apellidos" FROM ${s}."asignacion_tutor" at JOIN ${s}."docente" d ON d."id"=at."docente_id" JOIN ${s}."usuario" ut ON ut."id"=d."usuario_id" WHERE at."asignacion_tema_id"=a."id" AND at."estado"='VIGENTE' ORDER BY at."fecha_asignacion" DESC LIMIT 1) tutor ON true LEFT JOIN LATERAL (SELECT COALESCE(r."resultado"::text,'PENDIENTE') AS "revision" FROM ${s}."documento_pat" dp LEFT JOIN ${s}."revision_pat" r ON r."documento_pat_id"=dp."id" WHERE dp."asignacion_tema_id"=a."id" ORDER BY dp."version" DESC LIMIT 1) pat ON true WHERE ${conditions.join(' AND ')} ORDER BY a."id"`;
        columnas = ['Asignación','Estado de asignación','Fecha','Tema','Modalidad','Titular','Participantes','Nombres del tutor','Apellidos del tutor','Situación PAT']; break;
      }
      case ExportacionTipo.DOCENTES: {
        const conditions: string[] = [];
        if (filtros.estado_cuenta) conditions.push(`u."estado"=${add(filtros.estado_cuenta)}`);
        if (filtros.habilitado_tutoria !== undefined) conditions.push(`d."habilitado_tutoria"=${add(filtros.habilitado_tutoria)}`);
        sql = `SELECT d."id" AS "Docente", u."nombres" AS "Nombres", u."apellidos" AS "Apellidos", d."departamento" AS "Departamento", d."habilitado_tutoria" AS "Habilitado para tutoría", u."estado" AS "Estado de cuenta" FROM ${s}."docente" d JOIN ${s}."usuario" u ON u."id"=d."usuario_id" ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY d."id"`;
        columnas = ['Docente','Nombres','Apellidos','Departamento','Habilitado para tutoría','Estado de cuenta']; break;
      }
      case ExportacionTipo.CARGA_TUTORIAL: {
        const conditions = [`a."periodo_id"=$1`];
        if (filtros.docente_id) conditions.push(`d."id"=${add(filtros.docente_id)}`);
        sql = `SELECT d."id" AS "Docente", u."nombres" AS "Nombres", u."apellidos" AS "Apellidos", count(at."id") FILTER (WHERE at."estado"='VIGENTE' AND a."estado"='VIGENTE')::int AS "Carga actual", cfg."max_trabajos" AS "Máximo configurado", cfg."bloquear_al_superar" AS "Bloquear al superar", CASE WHEN cfg."id" IS NULL THEN NULL ELSE (count(at."id") FILTER (WHERE at."estado"='VIGENTE' AND a."estado"='VIGENTE') > cfg."max_trabajos") END AS "Excede límite" FROM ${s}."docente" d JOIN ${s}."usuario" u ON u."id"=d."usuario_id" LEFT JOIN ${s}."asignacion_tutor" at ON at."docente_id"=d."id" LEFT JOIN ${s}."asignacion_tema" a ON a."id"=at."asignacion_tema_id" AND a."periodo_id"=$1 LEFT JOIN LATERAL (SELECT c."id",c."max_trabajos",c."bloquear_al_superar" FROM ${s}."config_carga_tutorial" c WHERE c."periodo_id"=$1 AND (c."docente_id"=d."id" OR c."docente_id" IS NULL) ORDER BY (c."docente_id" IS NOT NULL) DESC LIMIT 1) cfg ON true WHERE ${conditions.join(' AND ')} GROUP BY d."id",u."nombres",u."apellidos",cfg."id",cfg."max_trabajos",cfg."bloquear_al_superar" ORDER BY d."id"`;
        columnas = ['Docente','Nombres','Apellidos','Carga actual','Máximo configurado','Bloquear al superar','Excede límite']; break;
      }
    }
    const rows = await manager.query(sql!, params) as Record<string, unknown>[];
    return { columnas: columnas!, filas: rows };
  }

  async withSnapshot<T>(callback: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction('REPEATABLE READ', callback);
  }

  private schema(manager: EntityManager): string {
    const value = (manager.connection.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('Esquema de base de datos no válido.');
    return `"${value}"`;
  }
}
