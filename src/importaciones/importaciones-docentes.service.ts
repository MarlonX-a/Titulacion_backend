import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import type { AppEnvironment } from '../config/environment.js';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CorreoSalida } from '../auth/entities/correo-salida.entity.js';
import { CredencialUsuario } from '../auth/entities/credencial-usuario.entity.js';
import { createEncryptedOutbox, createTemporaryCredentialHash, generateOneTimeSecret, readEncryptionKey, TEMP_PASSWORD_TTL_MS } from '../auth/credentials.js';
import { LoteImportacion } from './entities/lote-importacion.entity.js';
import { PreparacionImportacion } from './entities/preparacion-importacion.entity.js';
import { PreparacionImportacionEstado as EstadoPreparacion } from './enums/preparacion-importacion-estado.enum.js';
import { LoteImportacionEstado } from './enums/lote-importacion-estado.enum.js';
import { LoteImportacionTipo } from './enums/lote-importacion-tipo.enum.js';
import { normalizeExcelText, type ExcelRowError } from './estudiantes-excel.parser.js';
import { parseTeachersXlsx, type DocenteExcelRow } from './docentes-excel.parser.js';

const PREPARATION_TTL_MS = 12 * 60 * 60 * 1000;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const JOB_OPTIONS = { attempts: 3, backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: true, removeOnFail: false } as const;

export interface ImportacionDocentesResumen {
  id: string;
  tipo: LoteImportacionTipo.DOCENTES;
  nombre_archivo: string;
  estado: EstadoPreparacion;
  total_filas: number;
  errores: ExcelRowError[];
  /** Avisos no bloqueantes (por ejemplo, Tipo vacío); no impiden confirmar. */
  advertencias: ExcelRowError[];
  vista_previa: DocenteExcelRow[];
  lote_id: string | null;
  creada_en: Date;
  expira_en: Date;
}

interface TemporaryCredential { secret: string; hash: string; }

interface ImportCounts { creados: number; actualizados: number; omitidos: number; }

function response(record: PreparacionImportacion): ImportacionDocentesResumen {
  const rows = (record.filas as DocenteExcelRow[] | null) ?? [];
  return {
    id: record.id, tipo: LoteImportacionTipo.DOCENTES, nombre_archivo: record.nombre_archivo,
    estado: record.estado, total_filas: record.total_filas,
    errores: (record.errores as ExcelRowError[] | null) ?? [],
    advertencias: rows.filter((row) => row.advertencia).map((row) => ({ fila: row.fila, columna: 'Tipo', mensaje: row.advertencia ?? '' })),
    vista_previa: rows,
    lote_id: record.lote?.id ?? null, creada_en: record.creada_en, expira_en: record.expira_en,
  };
}

/**
 * Importación de docentes desde el Excel institucional (hoja «Tutores»: DOCENTES y Tipo). No
 * pertenece a un período: crea la cuenta DOCENTE, su perfil y una credencial temporal aleatoria
 * (como el alta manual, con correo ACCESO) en una transacción SERIALIZABLE. Un docente existente
 * con el mismo correo solo actualiza `habilitado_tutoria`; si no cambia, se omite.
 */
@Injectable()
export class ImportacionesDocentesService {
  private readonly encryptionKey: string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: AlmacenamientoService,
    private readonly auditoria: AuditoriaService,
    config: ConfigService<AppEnvironment, true>,
    @InjectQueue('importaciones') private readonly queue: Queue,
  ) {
    const keyPath = config.get('OUTBOX_ENCRYPTION_KEY_PATH', { infer: true });
    this.encryptionKey = keyPath ? readEncryptionKey(keyPath) : '';
  }

  async submit(actor: Usuario, originalName: string, buffer: Buffer, ip: string | null): Promise<{ id: string; estado: EstadoPreparacion }> {
    const filename = originalName.replaceAll('\\', '/').split('/').at(-1) ?? 'docentes.xlsx';
    const key = await this.storage.savePrivate(buffer, XLSX_MIME);
    let record: PreparacionImportacion;
    try {
      record = await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(PreparacionImportacion);
        const created = await repository.save(repository.create({
          periodo: null, tipo: LoteImportacionTipo.DOCENTES, solicitada_por: actor, lote: null,
          nombre_archivo: filename.slice(0, 200), ruta_almacenamiento: key,
          sha256: createHash('sha256').update(buffer).digest('hex'),
          estado: EstadoPreparacion.VALIDANDO, total_filas: 0, filas: null, errores: null,
          ip_origen: ip, expira_en: new Date(Date.now() + PREPARATION_TTL_MS),
        }));
        await this.auditoria.registrar(manager, {
          actor, accion: 'SOLICITAR_IMPORTACION_DOCENTES', entidad_tipo: 'preparacion_importacion', entidad_id: created.id,
          valores_anteriores: null, valores_nuevos: { tipo: LoteImportacionTipo.DOCENTES, sha256: created.sha256, nombre_archivo: created.nombre_archivo }, ip_origen: ip,
        });
        return created;
      });
    } catch (error: unknown) {
      await this.storage.removePrivate(key).catch(() => undefined);
      throw error;
    }
    await this.queue.add('validar-docentes', { id: record.id }, { jobId: `importacion-validar-${record.id}`, ...JOB_OPTIONS }).catch(() => undefined);
    return { id: record.id, estado: record.estado };
  }

  async validateFile(id: string): Promise<void> {
    const repository = this.dataSource.getRepository(PreparacionImportacion);
    const record = await repository.findOne({ where: { id, tipo: LoteImportacionTipo.DOCENTES } });
    if (!record || record.estado !== EstadoPreparacion.VALIDANDO || record.expira_en <= new Date()) return;
    try {
      const buffer = await this.storage.readPrivate(record.ruta_almacenamiento);
      const parsed = await parseTeachersXlsx(buffer);
      if (parsed.sha256 !== record.sha256) throw new ConflictException('El archivo cambió desde que se envió a validar.');
      const errors = [...parsed.errors, ...await this.validateExistingRows(parsed.rows)];
      record.total_filas = parsed.rows.length;
      record.filas = parsed.rows;
      record.errores = errors;
      record.estado = errors.length === 0 && parsed.rows.length > 0 ? EstadoPreparacion.LISTA : EstadoPreparacion.INVALIDA;
      await repository.save(record);
    } catch (error: unknown) {
      record.estado = EstadoPreparacion.INVALIDA;
      record.errores = [{ fila: 0, columna: 'archivo', mensaje: error instanceof BadRequestException || error instanceof ConflictException ? error.message : 'No se pudo validar el archivo o sus datos.' }];
      await repository.save(record);
    }
  }

  async get(id: string): Promise<ImportacionDocentesResumen> {
    const record = await this.dataSource.getRepository(PreparacionImportacion).findOne({ where: { id, tipo: LoteImportacionTipo.DOCENTES }, relations: { lote: true } });
    if (!record) throw new NotFoundException('No existe la preparación de importación de docentes indicada.');
    if (record.expira_en <= new Date() && [EstadoPreparacion.VALIDANDO, EstadoPreparacion.LISTA, EstadoPreparacion.INVALIDA].includes(record.estado)) throw new GoneException('La preparación venció; vuelve a cargar el archivo.');
    return response(record);
  }

  async confirm(id: string, actor: Usuario, ip: string | null): Promise<{ id: string; estado: EstadoPreparacion }> {
    const result = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(PreparacionImportacion);
      const record = await repository.findOne({ where: { id, tipo: LoteImportacionTipo.DOCENTES }, lock: { mode: 'pessimistic_write' } });
      if (!record) throw new NotFoundException('No existe la preparación de importación de docentes indicada.');
      if (record.estado === EstadoPreparacion.COMPLETADA) throw new ConflictException('La importación ya fue completada.');
      if (record.estado === EstadoPreparacion.LISTA) {
        if (record.expira_en <= new Date() || !Array.isArray(record.filas) || !Array.isArray(record.errores) || record.errores.length > 0) throw new ConflictException('La vista previa venció o tiene errores; vuelve a cargar el archivo.');
        record.estado = EstadoPreparacion.EN_COLA;
        await repository.save(record);
        await this.auditoria.registrar(manager, {
          actor, accion: 'CONFIRMAR_IMPORTACION_DOCENTES', entidad_tipo: 'preparacion_importacion', entidad_id: record.id,
          valores_anteriores: { estado: EstadoPreparacion.LISTA }, valores_nuevos: { estado: EstadoPreparacion.EN_COLA }, ip_origen: ip,
        });
      } else if (record.estado !== EstadoPreparacion.EN_COLA) {
        throw new ConflictException('Solo se puede confirmar una importación validada sin errores.');
      }
      return { id: record.id, estado: record.estado };
    });
    const jobId = `importacion-confirmar-${result.id}`;
    const existing = await this.queue.getJob(jobId);
    if (existing && (await existing.getState()) === 'failed') await existing.remove();
    await this.queue.add('importar-docentes', { id: result.id }, { jobId, ...JOB_OPTIONS });
    return result;
  }

  async importConfirmed(id: string): Promise<void> {
    const prepRepo = this.dataSource.getRepository(PreparacionImportacion);
    const record = await prepRepo.findOne({ where: { id, tipo: LoteImportacionTipo.DOCENTES }, relations: { solicitada_por: true } });
    if (!record || record.estado !== EstadoPreparacion.EN_COLA || record.expira_en <= new Date()) return;
    if (!Array.isArray(record.filas) || !Array.isArray(record.errores) || record.errores.length > 0) throw new ConflictException('La preparación ya no es válida.');
    const rows = record.filas as DocenteExcelRow[];
    const buffer = await this.storage.readPrivate(record.ruta_almacenamiento);
    if (createHash('sha256').update(buffer).digest('hex') !== record.sha256) throw new ConflictException('El archivo guardado no coincide con la vista previa validada.');
    // Clave temporal aleatoria (como el alta manual); el hash se calcula fuera de la transacción.
    const temporaryCredentials = new Map<string, TemporaryCredential>();
    const userRepo = this.dataSource.getRepository(Usuario);
    for (const row of rows) {
      if (await userRepo.findOne({ where: { email: row.email } })) continue;
      temporaryCredentials.set(row.email, await this.temporaryCredential());
    }
    try {
      const wasImported = await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
        const preparation = await manager.getRepository(PreparacionImportacion).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
        if (!preparation || preparation.estado !== EstadoPreparacion.EN_COLA) return false;
        if ((await this.validateExistingRows(rows, manager)).length > 0) throw new ConflictException('Los datos cambiaron desde la vista previa; vuelve a validar el archivo.');
        const now = new Date();
        const loteRepo = manager.getRepository(LoteImportacion);
        const lot = await loteRepo.save(loteRepo.create({
          periodo: null, ejecutado_por: record.solicitada_por, tipo: LoteImportacionTipo.DOCENTES,
          nombre_archivo: record.nombre_archivo, ruta_almacenamiento: record.ruta_almacenamiento,
          estado: LoteImportacionEstado.EN_PROCESO, total_filas: rows.length, filas_ok: 0, filas_error: 0,
          errores: null, fecha_inicio: now, fecha_fin: null,
        }));
        const counts = await this.createRows(manager, rows, temporaryCredentials, record, now);
        lot.filas_ok = rows.length;
        lot.estado = LoteImportacionEstado.COMPLETADO;
        lot.fecha_fin = new Date();
        await loteRepo.save(lot);
        record.estado = EstadoPreparacion.COMPLETADA;
        record.total_filas = rows.length;
        record.filas = null;
        record.errores = [];
        record.lote = lot;
        await manager.getRepository(PreparacionImportacion).save(record);
        await this.auditoria.registrar(manager, { actor: record.solicitada_por, accion: 'COMPLETAR_IMPORTACION_DOCENTES', entidad_tipo: 'lote_importacion', entidad_id: lot.id, valores_anteriores: null, valores_nuevos: { preparacion_id: record.id, total_filas: rows.length, filas_ok: lot.filas_ok, filas_error: 0, docentes_creados: counts.creados, docentes_actualizados: counts.actualizados, omitidos: counts.omitidos }, ip_origen: record.ip_origen });
        return true;
      });
      if (!wasImported) return;
    } catch (error: unknown) {
      if (error instanceof QueryFailedError) {
        const code = (error.driverError as { code?: string }).code;
        if (code === '40001' || code === '40P01') throw new ServiceUnavailableException('La importación se reintentará por concurrencia temporal.');
      }
      if (error instanceof ConflictException || error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof BadRequestException) {
        await prepRepo.update({ id }, { estado: EstadoPreparacion.INVALIDA, errores: [{ fila: 0, columna: 'confirmación', mensaje: error.message }] });
      } else {
        await prepRepo.update({ id }, { estado: EstadoPreparacion.FALLIDA, errores: [{ fila: 0, columna: 'importación', mensaje: 'No se pudo completar la importación. No se guardaron cambios parciales.' }] });
      }
      throw error instanceof ConflictException || error instanceof BadRequestException ? error : new ServiceUnavailableException('No se pudo completar la importación. No se guardaron cambios parciales.');
    }
  }

  private async temporaryCredential(): Promise<TemporaryCredential> {
    const secret = generateOneTimeSecret();
    return { secret, hash: await createTemporaryCredentialHash(secret) };
  }

  /** Crea cuenta, perfil y credencial faltantes, o actualiza la habilitación de tutoría existente. */
  private async createRows(manager: EntityManager, rows: DocenteExcelRow[], temporaryCredentials: Map<string, TemporaryCredential>, record: PreparacionImportacion, now: Date): Promise<ImportCounts> {
    const users = manager.getRepository(Usuario);
    const teachers = manager.getRepository(Docente);
    const credentials = manager.getRepository(CredencialUsuario);
    const outboxRepo = manager.getRepository(CorreoSalida);
    const counts: ImportCounts = { creados: 0, actualizados: 0, omitidos: 0 };
    for (const row of [...rows].sort((left, right) => left.email.localeCompare(right.email))) {
      let user = await users.findOne({ where: { email: row.email }, lock: { mode: 'pessimistic_write' } });
      if (!user) user = await users.save(users.create({ email: row.email, nombres: row.nombres, apellidos: row.apellidos, rol: UsuarioRol.DOCENTE, estado: UsuarioEstado.ACTIVO, id_externo_sso: null, ultimo_acceso: null }));
      const profile = await teachers.findOne({ where: { usuario: { id: user.id } }, lock: { mode: 'pessimistic_write' } });
      if (!profile) {
        const saved = await teachers.save(teachers.create({ usuario: user, cedula: null, titulo_academico: null, departamento: null, habilitado_tutoria: row.habilitado_tutoria }));
        counts.creados += 1;
        await this.auditoria.registrar(manager, { actor: record.solicitada_por, accion: 'IMPORTAR_DOCENTE', entidad_tipo: 'docente', entidad_id: saved.id, valores_anteriores: null, valores_nuevos: { usuario_id: user.id, email: user.email, nombres: user.nombres, apellidos: user.apellidos, tipo: row.tipo, habilitado_tutoria: saved.habilitado_tutoria, preparacion_id: record.id }, ip_origen: record.ip_origen });
      } else if (profile.habilitado_tutoria !== row.habilitado_tutoria) {
        const before = profile.habilitado_tutoria;
        await teachers.update({ id: profile.id }, { habilitado_tutoria: row.habilitado_tutoria });
        counts.actualizados += 1;
        await this.auditoria.registrar(manager, { actor: record.solicitada_por, accion: 'ACTUALIZAR_DOCENTE_IMPORTACION', entidad_tipo: 'docente', entidad_id: profile.id, valores_anteriores: { habilitado_tutoria: before }, valores_nuevos: { habilitado_tutoria: row.habilitado_tutoria, tipo: row.tipo, preparacion_id: record.id }, ip_origen: record.ip_origen });
      } else {
        counts.omitidos += 1;
      }
      const credential = await credentials.findOne({ where: { usuario_id: user.id }, lock: { mode: 'pessimistic_write' } });
      if (!credential) {
        const expiry = new Date(Date.now() + TEMP_PASSWORD_TTL_MS);
        const temporary = temporaryCredentials.get(row.email) ?? await this.temporaryCredential();
        await credentials.save(credentials.create({ usuario_id: user.id, password_hash: temporary.hash, requiere_cambio: true, temporal_expira_en: expiry, version_sesion: 0, actualizada_en: now }));
        await outboxRepo.save(createEncryptedOutbox(manager, user.id, 'ACCESO', temporary.secret, expiry, this.encryptionKey));
      }
    }
    return counts;
  }

  /**
   * Un correo generado que pertenece a una cuenta con otro rol, a una cuenta inactiva o a un
   * docente con otro nombre (sin importar mayúsculas, espacios ni tildes) es un error por fila.
   */
  private async validateExistingRows(rows: DocenteExcelRow[], manager: EntityManager = this.dataSource.manager): Promise<ExcelRowError[]> {
    const errors: ExcelRowError[] = [];
    const userRepo = manager.getRepository(Usuario);
    for (const row of rows) {
      const account = await userRepo.findOne({ where: { email: row.email } });
      if (!account) continue;
      if (account.rol !== UsuarioRol.DOCENTE) {
        errors.push({ fila: row.fila, columna: 'DOCENTES', mensaje: `El correo generado (${row.email}) pertenece a una cuenta con rol ${account.rol}; requiere revisión administrativa.` });
      } else if (account.estado !== UsuarioEstado.ACTIVO) {
        errors.push({ fila: row.fila, columna: 'DOCENTES', mensaje: `El correo generado (${row.email}) pertenece a una cuenta inactiva; requiere revisión administrativa.` });
      } else if (normalizeExcelText(`${account.nombres} ${account.apellidos}`) !== normalizeExcelText(`${row.nombres} ${row.apellidos}`)) {
        errors.push({ fila: row.fila, columna: 'DOCENTES', mensaje: `El correo generado (${row.email}) ya pertenece a otro docente (${account.nombres} ${account.apellidos}); requiere revisión administrativa.` });
      }
    }
    return errors;
  }
}
