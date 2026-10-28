import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, QueryFailedError, type FindOptionsWhere } from 'typeorm';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import type { ImportacionErrorFilaDto, ImportacionHistorialDto, ImportacionHistorialPageDto } from './dto/importacion-historial.dto.js';
import { PreparacionImportacion } from './entities/preparacion-importacion.entity.js';
import { LoteImportacionTipo } from './enums/lote-importacion-tipo.enum.js';
import { PreparacionImportacionEstado as Estado } from './enums/preparacion-importacion-estado.enum.js';

const VENCIBLES: readonly Estado[] = [Estado.VALIDANDO, Estado.LISTA, Estado.INVALIDA];

/** Historial de importaciones (preparaciones y su lote) para ADMIN; incluye las vencidas. */
@Injectable()
export class ImportacionesHistorialService {
  constructor(private readonly dataSource: DataSource) {}

  async listarEstudiantes(periodoId: string, query: PaginationQueryDto): Promise<ImportacionHistorialPageDto> {
    try {
      const periodo = await this.dataSource.getRepository(PeriodoTitulacion).findOneBy({ id: periodoId });
      if (!periodo) throw new NotFoundException('No existe el período indicado.');
      return await this.listar({ tipo: LoteImportacionTipo.ESTUDIANTES, periodo: { id: periodoId } }, query);
    } catch (error: unknown) { this.handleError(error); }
  }

  async listarDocentes(query: PaginationQueryDto): Promise<ImportacionHistorialPageDto> {
    try { return await this.listar({ tipo: LoteImportacionTipo.DOCENTES }, query); }
    catch (error: unknown) { this.handleError(error); }
  }

  private async listar(where: FindOptionsWhere<PreparacionImportacion>, query: PaginationQueryDto): Promise<ImportacionHistorialPageDto> {
    const [rows, total] = await this.dataSource.getRepository(PreparacionImportacion).findAndCount({
      where,
      // Excluye `filas` (vista previa completa) y la ruta de almacenamiento: no hacen falta en el historial.
      select: {
        id: true, tipo: true, nombre_archivo: true, estado: true, total_filas: true, errores: true, creada_en: true, expira_en: true,
        periodo: { id: true },
        lote: { id: true, estado: true, total_filas: true, filas_ok: true, filas_error: true, fecha_inicio: true, fecha_fin: true },
        solicitada_por: { id: true, nombres: true, apellidos: true },
      },
      relations: { periodo: true, lote: true, solicitada_por: true },
      order: { creada_en: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    const now = new Date();
    return { data: rows.map((row) => toHistorial(row, now)), total, page: query.page, limit: query.limit };
  }

  private handleError(error: unknown): never {
    if (error instanceof QueryFailedError) throw new ServiceUnavailableException('No fue posible consultar el historial de importaciones.');
    throw error;
  }
}

export function toHistorial(row: PreparacionImportacion, now: Date): ImportacionHistorialDto {
  const errores = Array.isArray(row.errores) ? row.errores as ImportacionErrorFilaDto[] : [];
  const filasConError = new Set(errores.filter((error) => error.fila > 0).map((error) => error.fila)).size;
  const lote = row.lote ? {
    id: row.lote.id, estado: row.lote.estado, total_filas: row.lote.total_filas, filas_ok: row.lote.filas_ok,
    filas_error: row.lote.filas_error, fecha_inicio: row.lote.fecha_inicio, fecha_fin: row.lote.fecha_fin,
  } : null;
  return {
    id: row.id,
    tipo: row.tipo,
    periodo_id: row.periodo?.id ?? null,
    nombre_archivo: row.nombre_archivo,
    estado: row.estado,
    expirada: VENCIBLES.includes(row.estado) && row.expira_en <= now,
    total_filas: row.total_filas,
    filas_ok: lote ? lote.filas_ok : Math.max(row.total_filas - filasConError, 0),
    filas_error: lote ? lote.filas_error : filasConError,
    errores,
    lote,
    solicitada_por: { id: row.solicitada_por.id, nombres: row.solicitada_por.nombres, apellidos: row.solicitada_por.apellidos },
    creada_en: row.creada_en,
    expira_en: row.expira_en,
  };
}
