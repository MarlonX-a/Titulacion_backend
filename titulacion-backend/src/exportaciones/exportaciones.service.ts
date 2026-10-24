import { randomUUID, createHash } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service.js';
import { ArchivoLimpiezaService } from '../almacenamiento/archivo-limpieza.service.js';
import { SolicitudExportacion } from './entities/solicitud-exportacion.entity.js';
import { ExportacionEstado } from './enums/exportacion-estado.enum.js';
import { ExportacionFormato } from './enums/exportacion-formato.enum.js';
import { ExportacionTipo } from './enums/exportacion-tipo.enum.js';
import { SolicitarExportacionDto } from './dto/solicitar-exportacion.dto.js';
import { ListarExportacionesQueryDto } from './dto/listar-exportaciones-query.dto.js';
import type { ExportacionDescargaDto, ExportacionPageDto, ExportacionResponseDto } from './dto/exportacion-response.dto.js';
import { renderExportacion } from './exportacion-archivo.js';
import { ReportesService } from '../reportes/reportes.service.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import type { AppEnvironment } from '../config/environment.js';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

const ARCHIVO_TTL_MS = 24 * 60 * 60_000;
const RESERVA_MS = 2 * 60_000;
const INTENTOS_MAXIMOS = 5;

export interface ExportacionJob { id: string; ciclo: number }
interface TrabajoReservado extends ExportacionJob { reserva_id: string }

function response(row: SolicitudExportacion): ExportacionResponseDto {
  return {
    id: row.id, periodo_id: row.periodo_id, tipo_reporte: row.tipo_reporte, formato: row.formato,
    estado: row.estado, filtros: row.filtros, tamano_bytes: row.tamano_bytes, hash_sha256: row.hash_sha256,
    fecha_solicitud: row.fecha_solicitud, fecha_generacion: row.fecha_generacion, expira_en: row.expira_en,
    expirada: row.expira_en !== null && row.expira_en.getTime() <= Date.now(),
  };
}

@Injectable()
export class ExportacionesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExportacionesService.name);
  private publishTimer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;
  private publishing = false;
  private readonly testMode: boolean;

  constructor(
    private readonly dataSource: DataSource,
    private readonly reportes: ReportesService,
    private readonly storage: AlmacenamientoService,
    private readonly cleanup: ArchivoLimpiezaService,
    private readonly auditoria: AuditoriaService,
    private readonly config: ConfigService<AppEnvironment, true>,
    @InjectRepository(SolicitudExportacion) private readonly repository: Repository<SolicitudExportacion>,
    @InjectQueue('exportaciones') private readonly queue: Queue<ExportacionJob>,
  ) { this.testMode = config.get('NODE_ENV', { infer: true }) === 'test'; }

  onModuleInit(): void {
    if (this.testMode) return;
    this.publishTimer = setInterval(() => void this.dispatchPending(), 5_000);
    this.publishTimer.unref();
    this.cleanupTimer = setInterval(() => void this.enqueueExpiredCleanup(), 30_000);
    this.cleanupTimer.unref();
    void this.dispatchPending();
    void this.enqueueExpiredCleanup();
  }

  onModuleDestroy(): void {
    if (this.publishTimer) clearInterval(this.publishTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async solicitar(periodoId: string, dto: SolicitarExportacionDto, actor: Usuario, ip: string | null): Promise<{ id: string; estado: ExportacionEstado }> {
    this.validateFilters(dto.tipo_reporte, dto.filtros ?? {});
    try {
      return await this.dataSource.transaction(async (manager) => {
        const period = await manager.query(`SELECT "id" FROM ${this.schema(manager)}."periodo_titulacion" WHERE "id"=$1`, [periodoId]) as Array<{ id: string }>;
        if (!period.length) throw new NotFoundException('No existe el período solicitado.');
        const row = await manager.getRepository(SolicitudExportacion).save(manager.getRepository(SolicitudExportacion).create({
          periodo_id: periodoId, solicitante_id: actor.id, tipo_reporte: dto.tipo_reporte,
          formato: dto.formato, filtros: dto.filtros ?? {}, estado: ExportacionEstado.EN_COLA,
          ruta_almacenamiento: null, tamano_bytes: null, hash_sha256: null, archivo_limpiado: false,
          expira_en: null, fecha_generacion: null, ciclo: 1, intentos: 0,
          proxima_ejecucion: new Date(), reserva_id: null, reserva_expira_en: null, error_sanitizado: null,
        }));
        await this.auditoria.registrar(manager, {
          actor, accion: 'SOLICITAR_EXPORTACION', entidad_tipo: 'solicitud_exportacion', entidad_id: row.id,
          valores_anteriores: null, valores_nuevos: { periodo_id: periodoId, tipo_reporte: dto.tipo_reporte, formato: dto.formato, filtros: dto.filtros ?? {} }, ip_origen: ip,
        });
        return { id: row.id, estado: row.estado };
      });
    } catch (error: unknown) { this.handleError(error); }
  }

  async listar(periodoId: string, actor: Usuario, query: ListarExportacionesQueryDto): Promise<ExportacionPageDto> {
    try {
      await this.assertPeriodExists(periodoId);
      const where: Record<string, unknown> = { periodo_id: periodoId, solicitante_id: actor.id };
      if (query.estado) where.estado = query.estado;
      if (query.tipo_reporte) where.tipo_reporte = query.tipo_reporte;
      if (query.formato) where.formato = query.formato;
      const [rows, total] = await this.repository.findAndCount({ where, order: { fecha_solicitud: 'DESC', id: 'ASC' }, skip: (query.page - 1) * query.limit, take: query.limit });
      return { data: rows.map(response), total, page: query.page, limit: query.limit };
    } catch (error: unknown) { this.handleError(error); }
  }

  async porId(periodoId: string, id: string, actor: Usuario): Promise<ExportacionResponseDto> {
    const item = await this.ownedRequest(periodoId, id, actor);
    return response(item);
  }

  async descarga(periodoId: string, id: string, actor: Usuario): Promise<ExportacionDescargaDto> {
    const item = await this.ownedRequest(periodoId, id, actor);
    if (item.estado !== ExportacionEstado.LISTO || !item.ruta_almacenamiento || !item.expira_en) throw new ConflictException('La exportación todavía no está disponible.');
    const now = Date.now();
    if (item.expira_en.getTime() <= now) throw new ConflictException('El archivo de exportación expiró.');
    const expira = new Date(Math.min(now + 5 * 60_000, item.expira_en.getTime()));
    const ext = item.formato.toLowerCase();
    const mime = item.formato === ExportacionFormato.PDF ? 'application/pdf' : item.formato === ExportacionFormato.XLSX ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8';
    try {
      const url = await this.storage.signPrivateDownload(item.ruta_almacenamiento, `reporte-${item.tipo_reporte}.${ext}`, mime, Math.max(1, Math.floor((expira.getTime() - now) / 1000)));
      return { url, expira_en: expira };
    } catch { throw new ServiceUnavailableException('No se pudo preparar la descarga.'); }
  }

  async reintentar(periodoId: string, id: string, actor: Usuario, ip: string | null): Promise<{ id: string; estado: ExportacionEstado }> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const row = await manager.getRepository(SolicitudExportacion).findOne({ where: { id, periodo_id: periodoId, solicitante_id: actor.id }, lock: { mode: 'pessimistic_write' } });
        if (!row) throw new NotFoundException('No existe la solicitud de exportación.');
        if (row.estado !== ExportacionEstado.FALLIDO) throw new ConflictException('Solo se pueden reintentar exportaciones fallidas.');
        const previous = { estado: row.estado, ciclo: row.ciclo, intentos: row.intentos };
        row.estado = ExportacionEstado.EN_COLA; row.ciclo += 1; row.intentos = 0; row.proxima_ejecucion = new Date();
        row.reserva_id = null; row.reserva_expira_en = null; row.error_sanitizado = null;
        await manager.getRepository(SolicitudExportacion).save(row);
        await this.auditoria.registrar(manager, { actor, accion: 'REINTENTAR_EXPORTACION', entidad_tipo: 'solicitud_exportacion', entidad_id: row.id, valores_anteriores: previous, valores_nuevos: { estado: row.estado, ciclo: row.ciclo, automatico: false }, ip_origen: ip });
        return { id: row.id, estado: row.estado };
      });
    } catch (error: unknown) { this.handleError(error); }
  }

  async procesar(job: ExportacionJob, reservaId: string): Promise<void> {
    const reserved: TrabajoReservado = { ...job, reserva_id: reservaId };
    const initial = await this.claimedRequest(reserved);
    if (!initial) return;
    const heartbeat = setInterval(() => void this.renewLease(reserved), 30_000);
    heartbeat.unref();
    let objectKey: string | null = null;
    let cleanupRegistered = false;
    try {
      const generated = await this.reportes.withSnapshot(async (manager) => {
        const requester = await manager.getRepository(Usuario).findOneBy({ id: initial.solicitante_id });
        if (!requester || requester.estado !== UsuarioEstado.ACTIVO || requester.rol !== UsuarioRol.ADMIN) throw new Error('requester-inactive');
        const result = await manager.query(`SELECT "nombre" FROM ${this.schema(manager)}."periodo_titulacion" WHERE "id"=$1`, [initial.periodo_id]) as Array<{ nombre: string }>;
        if (!result.length) throw new Error('period-missing');
        const cutoffRows = await manager.query('SELECT transaction_timestamp() AS cutoff') as Array<{ cutoff: Date }>;
        const cutoff = new Date(cutoffRows[0]!.cutoff);
        const datos = await this.reportes.generar(manager, initial.periodo_id, initial.tipo_reporte, initial.filtros);
        const buffer = await renderExportacion(initial.formato, datos, { periodo: result[0]!.nombre, filtros: initial.filtros, fecha_corte: cutoff });
        return { buffer, cutoff, actor: requester };
      });
      const extension = initial.formato.toLowerCase() as 'pdf' | 'xlsx' | 'csv';
      objectKey = this.storage.createPrivateKey('exportaciones', extension);
      await this.cleanup.registrar(null, objectKey); cleanupRegistered = true;
      const mime = initial.formato === ExportacionFormato.PDF ? 'application/pdf' : initial.formato === ExportacionFormato.XLSX ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8';
      await this.storage.saveAtPrivateKey(objectKey, generated.buffer, mime);
      const digest = createHash('sha256').update(generated.buffer).digest('hex');
      await this.dataSource.transaction(async (manager) => {
        const current = await manager.getRepository(SolicitudExportacion).findOne({ where: { id: job.id, ciclo: job.ciclo, estado: ExportacionEstado.PROCESANDO, reserva_id: reservaId }, lock: { mode: 'pessimistic_write' } });
        if (!current) throw new Error('lease-lost');
        const account = await manager.getRepository(Usuario).findOneBy({ id: current.solicitante_id });
        if (!account || account.estado !== UsuarioEstado.ACTIVO || account.rol !== UsuarioRol.ADMIN) throw new Error('requester-inactive');
        const before = { estado: current.estado };
        current.estado = ExportacionEstado.LISTO; current.ruta_almacenamiento = objectKey; current.tamano_bytes = String(generated.buffer.byteLength);
        current.hash_sha256 = digest; current.fecha_generacion = new Date(); current.expira_en = new Date(current.fecha_generacion.getTime() + ARCHIVO_TTL_MS);
        current.archivo_limpiado = false; current.reserva_id = null; current.reserva_expira_en = null; current.error_sanitizado = null;
        await manager.getRepository(SolicitudExportacion).save(current);
        await this.auditoria.registrar(manager, { actor: account, accion: 'FINALIZAR_EXPORTACION', entidad_tipo: 'solicitud_exportacion', entidad_id: current.id, valores_anteriores: before, valores_nuevos: { estado: current.estado, formato: current.formato, tamano_bytes: current.tamano_bytes, hash_sha256: digest, automatico: true }, ip_origen: null });
        await manager.query(`DELETE FROM ${this.schema(manager)}."archivo_limpieza_pendiente" WHERE "ruta_almacenamiento"=$1`, [objectKey]);
      });
      cleanupRegistered = false;
    } catch (error: unknown) {
      if (objectKey && cleanupRegistered) await this.cleanup.solicitar(undefined, objectKey);
      await this.recordFailure(reserved, error);
    } finally { clearInterval(heartbeat); }
  }

  async dispatchPending(): Promise<void> {
    if (this.publishing || this.testMode) return;
    this.publishing = true;
    try {
      await this.recoverExpiredLeases();
      const ready = await this.repository.find({ where: { estado: ExportacionEstado.EN_COLA }, order: { proxima_ejecucion: 'ASC' }, take: 50 });
      for (const item of ready) {
        const reservation = randomUUID();
        const claimed = await this.repository.createQueryBuilder().update(SolicitudExportacion)
          .set({ estado: ExportacionEstado.PROCESANDO, reserva_id: reservation, reserva_expira_en: new Date(Date.now() + RESERVA_MS), intentos: () => '"intentos" + 1' })
          .where('"id" = :id AND "estado" = :state AND "ciclo" = :cycle AND "proxima_ejecucion" <= CURRENT_TIMESTAMP', { id: item.id, state: ExportacionEstado.EN_COLA, cycle: item.ciclo }).execute();
        if (!claimed.affected) continue;
        try {
          await this.queue.add('generar-exportacion', { id: item.id, ciclo: item.ciclo }, { jobId: reservation, removeOnComplete: true, removeOnFail: true });
        } catch {
          await this.repository.createQueryBuilder().update(SolicitudExportacion).set({ estado: ExportacionEstado.EN_COLA, reserva_id: null, reserva_expira_en: null, intentos: () => 'GREATEST("intentos" - 1, 0)' }).where('"id"=:id AND "reserva_id"=:reservation', { id: item.id, reservation }).execute();
          this.logger.warn('Redis no está disponible; la exportación quedó pendiente en PostgreSQL.');
          break;
        }
      }
    } catch { this.logger.warn('No se pudieron publicar exportaciones pendientes; se reintentará automáticamente.'); }
    finally { this.publishing = false; }
  }

  private async recoverExpiredLeases(): Promise<void> {
    const stale = await this.repository.find({ where: { estado: ExportacionEstado.PROCESANDO }, take: 100 });
    for (const item of stale) {
      if (!item.reserva_expira_en || item.reserva_expira_en.getTime() > Date.now()) continue;
      if (item.intentos >= INTENTOS_MAXIMOS) await this.markFailedWithoutLease(item);
      else {
        await this.repository.createQueryBuilder().update(SolicitudExportacion)
          .set({ estado: ExportacionEstado.EN_COLA, reserva_id: null, reserva_expira_en: null, proxima_ejecucion: new Date(Date.now() + this.backoff(item.intentos)) })
          .where('"id"=:id AND "estado"=:state AND "reserva_id"=:reservation AND "reserva_expira_en"<=CURRENT_TIMESTAMP', { id: item.id, state: ExportacionEstado.PROCESANDO, reservation: item.reserva_id }).execute();
      }
    }
  }

  private async markFailedWithoutLease(row: SolicitudExportacion): Promise<void> {
    if (!row.reserva_id) return;
    const reservation = row.reserva_id;
    try {
      await this.dataSource.transaction(async (manager) => {
        const current = await manager.getRepository(SolicitudExportacion).findOne({ where: { id: row.id, estado: ExportacionEstado.PROCESANDO, reserva_id: reservation }, lock: { mode: 'pessimistic_write' } });
        if (!current) return;
        current.estado = ExportacionEstado.FALLIDO; current.reserva_id = null; current.reserva_expira_en = null; current.error_sanitizado = 'No se pudo completar el reporte después de varios intentos.';
        await manager.getRepository(SolicitudExportacion).save(current);
        const actor = await manager.getRepository(Usuario).findOneBy({ id: current.solicitante_id });
        if (actor) await this.auditoria.registrar(manager, { actor, accion: 'FALLAR_EXPORTACION', entidad_tipo: 'solicitud_exportacion', entidad_id: current.id, valores_anteriores: { estado: ExportacionEstado.PROCESANDO }, valores_nuevos: { estado: ExportacionEstado.FALLIDO, automatico: true }, ip_origen: null });
      });
    } catch { /* la próxima pasada vuelve a reclamar la reserva expirada */ }
  }

  private async claimedRequest(job: TrabajoReservado): Promise<SolicitudExportacion | null> {
    return this.repository.findOne({ where: { id: job.id, ciclo: job.ciclo, estado: ExportacionEstado.PROCESANDO, reserva_id: job.reserva_id } });
  }

  private async renewLease(job: TrabajoReservado): Promise<void> {
    try { await this.repository.createQueryBuilder().update(SolicitudExportacion).set({ reserva_expira_en: new Date(Date.now() + RESERVA_MS) }).where('"id"=:id AND "ciclo"=:cycle AND "estado"=:state AND "reserva_id"=:reservation', { id: job.id, cycle: job.ciclo, state: ExportacionEstado.PROCESANDO, reservation: job.reserva_id }).execute(); } catch { /* el lease vencerá y otro ciclo lo recuperará */ }
  }

  private async recordFailure(job: TrabajoReservado, _cause: unknown): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        const current = await manager.getRepository(SolicitudExportacion).findOne({ where: { id: job.id, ciclo: job.ciclo, estado: ExportacionEstado.PROCESANDO, reserva_id: job.reserva_id }, lock: { mode: 'pessimistic_write' } });
        if (!current) return;
        const before = { estado: current.estado, intentos: current.intentos };
        current.reserva_id = null; current.reserva_expira_en = null; current.error_sanitizado = 'No se pudo generar el reporte. Puedes solicitar un reintento.';
        current.estado = current.intentos >= INTENTOS_MAXIMOS ? ExportacionEstado.FALLIDO : ExportacionEstado.EN_COLA;
        current.proxima_ejecucion = new Date(Date.now() + this.backoff(current.intentos));
        await manager.getRepository(SolicitudExportacion).save(current);
        const actor = await manager.getRepository(Usuario).findOneBy({ id: current.solicitante_id });
        if (actor && current.estado === ExportacionEstado.FALLIDO) await this.auditoria.registrar(manager, { actor, accion: 'FALLAR_EXPORTACION', entidad_tipo: 'solicitud_exportacion', entidad_id: current.id, valores_anteriores: before, valores_nuevos: { estado: current.estado, automatico: true }, ip_origen: null });
      });
    } catch { this.logger.error('No se pudo guardar el resultado del intento de exportación.'); }
  }

  private async enqueueExpiredCleanup(): Promise<void> {
    try {
      const expired = await this.repository.find({ where: { estado: ExportacionEstado.LISTO, archivo_limpiado: false }, take: 100 });
      for (const item of expired) {
        if (!item.ruta_almacenamiento || !item.expira_en || item.expira_en.getTime() > Date.now()) continue;
        const registered = await this.cleanup.registrar(null, item.ruta_almacenamiento);
        if (registered) await this.cleanup.solicitar(undefined, item.ruta_almacenamiento);
      }
    } catch { /* persistencia y objetos se conservan para la siguiente pasada */ }
  }

  private async ownedRequest(periodoId: string, id: string, actor: Usuario): Promise<SolicitudExportacion> {
    try {
      await this.assertPeriodExists(periodoId);
      const row = await this.repository.findOneBy({ id, periodo_id: periodoId, solicitante_id: actor.id });
      if (!row) throw new NotFoundException('No existe la solicitud de exportación.');
      return row;
    } catch (error: unknown) { this.handleError(error); }
  }

  private async assertPeriodExists(id: string): Promise<void> {
    const rows = await this.dataSource.query(`SELECT 1 FROM ${this.schema(this.dataSource.manager)}."periodo_titulacion" WHERE "id"=$1`, [id]) as unknown[];
    if (!rows.length) throw new NotFoundException('No existe el período solicitado.');
  }

  private validateFilters(tipo: ExportacionTipo, filters: Record<string, unknown>): void {
    const allowed: Record<ExportacionTipo, string[]> = {
      [ExportacionTipo.ESTUDIANTES]: ['estado','condicion_ingreso','situacion_ingreso'],
      [ExportacionTipo.GRUPOS]: ['estado'],
      [ExportacionTipo.TEMAS_OFERTADOS]: ['linea_id','docente_proponente_id','estado'],
      [ExportacionTipo.TEMAS_DISPONIBLES]: ['linea_id','docente_proponente_id'],
      [ExportacionTipo.TEMAS_ASIGNADOS]: ['estado','modalidad'],
      [ExportacionTipo.DOCENTES]: ['estado_cuenta','habilitado_tutoria'],
      [ExportacionTipo.CARGA_TUTORIAL]: ['docente_id'],
    };
    for (const [key, value] of Object.entries(filters)) {
      if (!allowed[tipo].includes(key)) throw new BadRequestException(`El filtro ${key} no corresponde al reporte solicitado.`);
      if (typeof value !== 'string' && typeof value !== 'boolean') throw new BadRequestException(`El filtro ${key} tiene un valor inválido.`);
      if (typeof value === 'string' && value.trim() === '') throw new BadRequestException(`El filtro ${key} no puede estar vacío.`);
    }
    const enums: Record<string, string[]> = {
      estado: tipo === ExportacionTipo.ESTUDIANTES ? ['HABILITADO','SUSPENDIDO']
        : tipo === ExportacionTipo.GRUPOS ? ['EN_CONFORMACION','ACTIVO','DISUELTO','ANULADO']
        : tipo === ExportacionTipo.TEMAS_OFERTADOS ? ['BORRADOR','PUBLICADO','CERRADO','ASIGNADO','RETIRADO']
        : tipo === ExportacionTipo.TEMAS_ASIGNADOS ? ['VIGENTE','ANULADA'] : [],
      condicion_ingreso: ['REGULAR','CONDICIONADO'], situacion_ingreso: ['PENDIENTE','ADMITIDO','NO_ADMITIDO'],
      estado_cuenta: ['ACTIVO','INACTIVO'], modalidad: ['INDIVIDUAL','GRUPAL'],
    };
    for (const [key, values] of Object.entries(enums)) if (key in filters && (typeof filters[key] !== 'string' || !values.includes(filters[key] as string))) throw new BadRequestException(`El filtro ${key} no es válido.`);
    for (const key of ['linea_id','docente_proponente_id','docente_id']) if (key in filters && (typeof filters[key] !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(filters[key] as string))) throw new BadRequestException(`El filtro ${key} debe ser UUID.`);
    if ('habilitado_tutoria' in filters && typeof filters.habilitado_tutoria !== 'boolean') throw new BadRequestException('habilitado_tutoria debe ser booleano.');
  }

  private backoff(attempt: number): number { return 3_000 * 2 ** Math.max(0, Math.min(attempt - 1, 8)); }

  private schema(manager: EntityManager): string {
    const value = (manager.connection.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('Esquema PostgreSQL configurado no válido.');
    return `"${value}"`;
  }

  private handleError(error: unknown): never {
    if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof ServiceUnavailableException) throw error;
    if (error instanceof QueryFailedError) throw new ServiceUnavailableException('No fue posible consultar o actualizar las exportaciones.');
    throw error;
  }
}
