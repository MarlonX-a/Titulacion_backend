import { BadRequestException, ConflictException, GoneException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, QueryFailedError, type EntityManager } from 'typeorm';
import { AcademicoService } from '../academico/academico.service.js';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { LineaInvestigacion } from '../lineas-investigacion/entities/linea-investigacion.entity.js';
import { TemaHistorial } from '../temas/entities/tema-historial.entity.js';
import { Tema } from '../temas/entities/tema.entity.js';
import { EstadoTema } from '../temas/enums/estado-tema.enum.js';
import { TipoTema } from '../temas/enums/tipo-tema.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { coincidirDocente, normalizarNombre, type DocenteCandidato } from './docente-matcher.js';
import type { ResolverDocentesImportacionDto } from './dto/resolver-docentes-importacion.dto.js';
import type { ValidarImportacionTemasDto } from './dto/validar-importacion-temas.dto.js';
import { LoteImportacion } from './entities/lote-importacion.entity.js';
import { PreparacionImportacion } from './entities/preparacion-importacion.entity.js';
import { LoteImportacionEstado } from './enums/lote-importacion-estado.enum.js';
import { LoteImportacionTipo } from './enums/lote-importacion-tipo.enum.js';
import { PreparacionImportacionEstado as EstadoPreparacion } from './enums/preparacion-importacion-estado.enum.js';
import { normalizeExcelText, type ExcelRowError } from './estudiantes-excel.parser.js';
import { parseTemasXlsx, type TemaExcelRow } from './temas-excel.parser.js';

const PREPARATION_TTL_MS = 12 * 60 * 60 * 1000;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const AVISO_DOCENTE = 'elige el docente.';
const AVISO_EXISTENTE = 'El tema ya existe en el banco de la carrera; se omitirá.';

export type EstadoFilaTema = 'LISTA' | 'PENDIENTE_DOCENTE' | 'DUPLICADA' | 'ERROR';

export interface FilaImportacionTema {
  fila: number;
  nro: string | null;
  docente_excel: string;
  titulo: string;
  descripcion: string | null;
  docente: DocenteCandidato | null;
  candidatos: DocenteCandidato[];
  estado: EstadoFilaTema;
  errores: string[];
  advertencias: string[];
}

interface DatosPreparacionTemas { linea_id: string; tipo: TipoTema; filas: FilaImportacionTema[]; }

export interface ImportacionTemasResumen {
  id: string;
  tipo: LoteImportacionTipo.TEMAS;
  nombre_archivo: string;
  estado: EstadoPreparacion;
  carrera_id: string | null;
  linea_id: string;
  tipo_tema: TipoTema;
  total_filas: number;
  listas: number;
  pendientes: number;
  duplicadas: number;
  con_errores: number;
  /** True when the preview is LISTA, has no errors nor pending teachers and creates at least one topic. */
  puede_confirmar: boolean;
  filas: FilaImportacionTema[];
  lote_id: string | null;
  creada_en: Date;
  expira_en: Date;
}

export interface ConfirmacionImportacionTemas { id: string; estado: EstadoPreparacion; lote_id: string; creados: number; omitidos: number; }

function datosDe(record: PreparacionImportacion): DatosPreparacionTemas {
  return record.filas as DatosPreparacionTemas;
}

function resumen(record: PreparacionImportacion): ImportacionTemasResumen {
  const datos = datosDe(record);
  const contar = (estado: EstadoFilaTema) => datos.filas.filter((fila) => fila.estado === estado).length;
  const listas = contar('LISTA');
  const pendientes = contar('PENDIENTE_DOCENTE');
  const conErrores = contar('ERROR');
  return {
    id: record.id, tipo: LoteImportacionTipo.TEMAS, nombre_archivo: record.nombre_archivo, estado: record.estado,
    carrera_id: record.carrera_id, linea_id: datos.linea_id, tipo_tema: datos.tipo, total_filas: record.total_filas,
    listas, pendientes, duplicadas: contar('DUPLICADA'), con_errores: conErrores,
    puede_confirmar: record.estado === EstadoPreparacion.LISTA && pendientes === 0 && conErrores === 0 && listas > 0,
    filas: datos.filas, lote_id: record.lote?.id ?? null, creada_en: record.creada_en, expira_en: record.expira_en,
  };
}

function erroresDeFilas(filas: FilaImportacionTema[]): ExcelRowError[] {
  return filas.flatMap((fila) => fila.errores.map((mensaje) => ({ fila: fila.fila, columna: 'fila', mensaje })));
}

/**
 * Topic import from the institutional sheet (Nro., Docente, Temas, Carrera, Observación). The form's
 * career, research line and type apply to every row; teachers are matched by name and the pending
 * ones are resolved in the preview before a single-transaction confirmation creates PUBLICADO topics.
 */
@Injectable()
export class ImportacionesTemasService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: AlmacenamientoService,
    private readonly auditoria: AuditoriaService,
    private readonly academico: AcademicoService = new AcademicoService(),
  ) {}

  async validar(actor: Usuario, originalName: string, buffer: Buffer, ip: string | null, dto: ValidarImportacionTemasDto): Promise<ImportacionTemasResumen> {
    const carrera = await this.academico.buscarCarrera(this.dataSource, dto.carrera_id);
    await this.lineaActiva(this.dataSource.manager, dto.linea_id);
    const parsed = await parseTemasXlsx(buffer, carrera.nombre);
    const docentes = await this.docentesDeCarrera(this.dataSource.manager, carrera.id);
    const existentes = await this.titulosDeCarrera(this.dataSource.manager, carrera.id);
    const filas = parsed.rows.map((row) => this.filaPreview(row, docentes, existentes));
    const nombre = (originalName.replaceAll('\\', '/').split('/').at(-1) ?? 'temas.xlsx').slice(0, 200);
    const key = await this.storage.savePrivate(buffer, XLSX_MIME);
    try {
      const record = await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(PreparacionImportacion);
        const datos: DatosPreparacionTemas = { linea_id: dto.linea_id, tipo: dto.tipo, filas };
        const created = await repository.save(repository.create({
          periodo: null, tipo: LoteImportacionTipo.TEMAS, carrera_id: carrera.id, solicitada_por: actor, lote: null,
          nombre_archivo: nombre, ruta_almacenamiento: key, sha256: parsed.sha256,
          estado: filas.some((fila) => fila.estado === 'ERROR') ? EstadoPreparacion.INVALIDA : EstadoPreparacion.LISTA,
          total_filas: filas.length, filas: datos, errores: erroresDeFilas(filas), ip_origen: ip,
          expira_en: new Date(Date.now() + PREPARATION_TTL_MS),
        }));
        await this.auditoria.registrar(manager, {
          actor, accion: 'SOLICITAR_IMPORTACION_TEMAS', entidad_tipo: 'preparacion_importacion', entidad_id: created.id, valores_anteriores: null,
          valores_nuevos: { tipo: LoteImportacionTipo.TEMAS, sha256: parsed.sha256, nombre_archivo: nombre, carrera_id: carrera.id, linea_id: dto.linea_id, tipo_tema: dto.tipo, total_filas: filas.length },
          ip_origen: ip,
        });
        return created;
      });
      return resumen(record);
    } catch (error: unknown) {
      await this.storage.removePrivate(key).catch(() => undefined);
      throw error;
    }
  }

  async get(id: string): Promise<ImportacionTemasResumen> {
    const record = await this.dataSource.getRepository(PreparacionImportacion).findOne({ where: { id, tipo: LoteImportacionTipo.TEMAS }, relations: { lote: true } });
    if (!record) throw new NotFoundException('No existe la preparación de importación de temas indicada.');
    this.assertVigente(record);
    return resumen(record);
  }

  async resolverDocentes(id: string, dto: ResolverDocentesImportacionDto, actor: Usuario, ip: string | null): Promise<ImportacionTemasResumen> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(PreparacionImportacion);
      const record = await this.bloquearPreparacion(manager, id);
      if (record.estado !== EstadoPreparacion.LISTA) throw new ConflictException('Corrige los errores del archivo y vuelve a validarlo antes de resolver docentes.');
      const docentes = new Map((await this.docentesDeCarrera(manager, record.carrera_id!)).map((docente) => [docente.id, docente]));
      const datos = datosDe(record);
      const filas = datos.filas.map((fila) => ({ ...fila, advertencias: [...fila.advertencias] }));
      const aplicadas: Array<{ nombre_excel: string; docente_id: string; filas: number[] }> = [];
      for (const resolucion of dto.resoluciones) {
        const docente = docentes.get(resolucion.docente_id);
        if (!docente) throw new BadRequestException(`El docente elegido para «${resolucion.nombre_excel}» no es un docente activo de la carrera.`);
        const nombre = normalizarNombre(resolucion.nombre_excel);
        const objetivo = filas.filter((fila) => fila.estado !== 'ERROR' && normalizarNombre(fila.docente_excel) === nombre);
        if (objetivo.length === 0) throw new BadRequestException(`No hay filas con el docente «${resolucion.nombre_excel}».`);
        for (const fila of objetivo) {
          fila.docente = docente;
          fila.candidatos = [];
          fila.advertencias = fila.advertencias.filter((aviso) => !aviso.endsWith(AVISO_DOCENTE));
          if (fila.estado === 'PENDIENTE_DOCENTE') fila.estado = 'LISTA';
        }
        aplicadas.push({ nombre_excel: resolucion.nombre_excel, docente_id: docente.id, filas: objetivo.map((fila) => fila.fila) });
      }
      record.filas = { ...datos, filas };
      await repository.save(record);
      await this.auditoria.registrar(manager, {
        actor, accion: 'RESOLVER_DOCENTES_IMPORTACION_TEMAS', entidad_tipo: 'preparacion_importacion', entidad_id: record.id,
        valores_anteriores: null, valores_nuevos: { resoluciones: aplicadas }, ip_origen: ip,
      });
      return resumen(record);
    });
  }

  async confirmar(id: string, actor: Usuario, ip: string | null): Promise<ConfirmacionImportacionTemas> {
    try {
      return await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
        const record = await this.bloquearPreparacion(manager, id);
        const datos = datosDe(record);
        if (record.estado !== EstadoPreparacion.LISTA || datos.filas.some((fila) => fila.estado === 'ERROR' || fila.estado === 'PENDIENTE_DOCENTE')) {
          throw new ConflictException('Resuelve los docentes pendientes y corrige los errores antes de confirmar.');
        }
        const carreraId = record.carrera_id!;
        const linea = await this.lineaActiva(manager, datos.linea_id);
        const docentes = new Set((await this.docentesDeCarrera(manager, carreraId)).map((docente) => docente.id));
        const existentes = await this.titulosDeCarrera(manager, carreraId);
        const now = new Date();
        const loteRepo = manager.getRepository(LoteImportacion);
        const lote = await loteRepo.save(loteRepo.create({
          periodo: null, ejecutado_por: actor, tipo: LoteImportacionTipo.TEMAS, nombre_archivo: record.nombre_archivo,
          ruta_almacenamiento: record.ruta_almacenamiento, estado: LoteImportacionEstado.EN_PROCESO,
          total_filas: datos.filas.length, filas_ok: 0, filas_error: 0, errores: null, fecha_inicio: now, fecha_fin: null,
        }));
        const temaRepo = manager.getRepository(Tema);
        const historialRepo = manager.getRepository(TemaHistorial);
        const omitidas: ExcelRowError[] = [];
        let creados = 0;
        for (const fila of datos.filas) {
          const clave = normalizeExcelText(fila.titulo);
          if (fila.estado !== 'LISTA' || existentes.has(clave)) {
            omitidas.push({ fila: fila.fila, columna: 'Temas', mensaje: 'Tema duplicado; se omitió.' });
            continue;
          }
          const docente = fila.docente!;
          if (!docentes.has(docente.id)) {
            throw new ConflictException(`El docente «${docente.nombres} ${docente.apellidos}» ya no está activo en la carrera; vuelve a validar el archivo.`);
          }
          existentes.add(clave);
          const descripcion = fila.descripcion ?? fila.titulo;
          const tema = await temaRepo.save(temaRepo.create({
            carrera_id: carreraId, linea, docente_proponente: { id: docente.id } as Docente, tipo: datos.tipo,
            titulo: fila.titulo, descripcion, estado: EstadoTema.PUBLICADO, lote_importacion_id: lote.id,
          }));
          const valores = { carrera_id: carreraId, linea_id: linea.id, docente_proponente_id: docente.id, tipo: datos.tipo, titulo: fila.titulo, descripcion, estado: EstadoTema.PUBLICADO, lote_importacion_id: lote.id };
          await historialRepo.save(historialRepo.create({
            tema, usuario: actor, estado_anterior: null, estado_nuevo: EstadoTema.PUBLICADO,
            cambios: { anteriores: null, nuevos: valores, origen: 'IMPORTACION', fila: fila.fila }, fecha: now,
          }));
          await this.auditoria.registrar(manager, {
            actor, accion: 'IMPORTAR_TEMA', entidad_tipo: 'tema', entidad_id: tema.id,
            valores_anteriores: null, valores_nuevos: { ...valores, preparacion_id: record.id }, ip_origen: ip,
          });
          creados += 1;
        }
        lote.filas_ok = creados;
        lote.filas_error = omitidas.length;
        lote.errores = omitidas.length > 0 ? omitidas : null;
        lote.estado = omitidas.length > 0 ? LoteImportacionEstado.COMPLETADO_CON_ERRORES : LoteImportacionEstado.COMPLETADO;
        lote.fecha_fin = new Date();
        await loteRepo.save(lote);
        record.estado = EstadoPreparacion.COMPLETADA;
        record.lote = lote;
        await manager.getRepository(PreparacionImportacion).save(record);
        await this.auditoria.registrar(manager, {
          actor, accion: 'COMPLETAR_IMPORTACION_TEMAS', entidad_tipo: 'lote_importacion', entidad_id: lote.id, valores_anteriores: null,
          valores_nuevos: { preparacion_id: record.id, total_filas: datos.filas.length, temas_creados: creados, omitidos: omitidas.length }, ip_origen: ip,
        });
        return { id: record.id, estado: record.estado, lote_id: lote.id, creados, omitidos: omitidas.length };
      });
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      const code = error instanceof QueryFailedError ? (error.driverError as { code?: string }).code : undefined;
      if (code === '40001' || code === '40P01') throw new ConflictException('La importación coincidió con otro cambio simultáneo. Vuelve a confirmarla.');
      throw new ServiceUnavailableException('No se pudo completar la importación de temas. No se guardaron cambios parciales.', { cause: error });
    }
  }

  private filaPreview(row: TemaExcelRow, docentes: DocenteCandidato[], existentes: Set<string>): FilaImportacionTema {
    const advertencias = [...row.advertencias];
    const yaExiste = row.titulo.length > 0 && existentes.has(normalizeExcelText(row.titulo));
    if (yaExiste) advertencias.push(AVISO_EXISTENTE);
    const coincidencia = coincidirDocente(row.docente, docentes);
    let estado: EstadoFilaTema;
    if (row.errores.length > 0) estado = 'ERROR';
    else if (row.duplicado || yaExiste) estado = 'DUPLICADA';
    else if (coincidencia.docente) estado = 'LISTA';
    else {
      estado = 'PENDIENTE_DOCENTE';
      advertencias.push(coincidencia.candidatos.length > 0
        ? `Varios docentes de la carrera coinciden con «${row.docente}»; ${AVISO_DOCENTE}`
        : `Ningún docente activo de la carrera coincide con «${row.docente}»; ${AVISO_DOCENTE}`);
    }
    return {
      fila: row.fila, nro: row.nro, docente_excel: row.docente, titulo: row.titulo, descripcion: row.descripcion,
      docente: coincidencia.docente, candidatos: coincidencia.candidatos, estado, errores: row.errores, advertencias,
    };
  }

  private async bloquearPreparacion(manager: EntityManager, id: string): Promise<PreparacionImportacion> {
    const record = await manager.getRepository(PreparacionImportacion).findOne({ where: { id, tipo: LoteImportacionTipo.TEMAS }, lock: { mode: 'pessimistic_write' } });
    if (!record) throw new NotFoundException('No existe la preparación de importación de temas indicada.');
    if (record.estado === EstadoPreparacion.COMPLETADA) throw new ConflictException('La importación ya fue completada.');
    this.assertVigente(record);
    return record;
  }

  private assertVigente(record: PreparacionImportacion): void {
    if (record.expira_en <= new Date() && [EstadoPreparacion.LISTA, EstadoPreparacion.INVALIDA].includes(record.estado)) {
      throw new GoneException('La preparación venció; vuelve a cargar el archivo.');
    }
  }

  private async lineaActiva(manager: Pick<EntityManager, 'getRepository'>, lineaId: string): Promise<LineaInvestigacion> {
    const linea = await manager.getRepository(LineaInvestigacion).findOne({ where: { id: lineaId } });
    if (!linea) throw new NotFoundException('No existe la línea de investigación indicada.');
    if (!linea.activa) throw new ConflictException('La línea de investigación está inactiva.');
    return linea;
  }

  /** ACTIVE DOCENTE accounts of the career: a topic's proponent must belong to the topic's career. */
  private async docentesDeCarrera(manager: Pick<EntityManager, 'getRepository'>, carreraId: string): Promise<DocenteCandidato[]> {
    const rows = await manager.getRepository(Docente).find({ where: { carrera_id: carreraId }, relations: { usuario: true } });
    return rows
      .filter((docente) => docente.usuario.estado === UsuarioEstado.ACTIVO && docente.usuario.rol === UsuarioRol.DOCENTE)
      .map((docente) => ({ id: docente.id, nombres: docente.usuario.nombres, apellidos: docente.usuario.apellidos }));
  }

  private async titulosDeCarrera(manager: Pick<EntityManager, 'getRepository'>, carreraId: string): Promise<Set<string>> {
    const temas = await manager.getRepository(Tema).find({ where: { carrera_id: carreraId }, select: { id: true, titulo: true } });
    return new Set(temas.map((tema) => normalizeExcelText(tema.titulo)));
  }
}
