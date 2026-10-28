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
import { createEncryptedOutbox, createTemporaryCredentialHash, readEncryptionKey, TEMP_PASSWORD_TTL_MS } from '../auth/credentials.js';
import { LoteImportacion } from './entities/lote-importacion.entity.js';
import { PreparacionImportacion } from './entities/preparacion-importacion.entity.js';
import { PreparacionImportacionEstado as EstadoPreparacion } from './enums/preparacion-importacion-estado.enum.js';
import { LoteImportacionEstado } from './enums/lote-importacion-estado.enum.js';
import { LoteImportacionTipo } from './enums/lote-importacion-tipo.enum.js';
import type { ExcelRowError } from './estudiantes-excel.parser.js';
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
  vista_previa: DocenteExcelRow[];
  lote_id: string | null;
  creada_en: Date;
  expira_en: Date;
}

function response(record: PreparacionImportacion): ImportacionDocentesResumen {
  return {
    id: record.id, tipo: LoteImportacionTipo.DOCENTES, nombre_archivo: record.nombre_archivo,
    estado: record.estado, total_filas: record.total_filas,
    errores: (record.errores as ExcelRowError[] | null) ?? [],
    vista_previa: (record.filas as DocenteExcelRow[] | null) ?? [],
    lote_id: record.lote?.id ?? null, creada_en: record.creada_en, expira_en: record.expira_en,
  };
}

function profileMatches(profile: Docente, row: DocenteExcelRow): boolean {
  return profile.cedula === row.cedula && profile.titulo_academico === row.titulo_academico
    && profile.departamento === row.departamento && profile.habilitado_tutoria === row.habilitado_tutoria;
}

/**
 * Importación de docentes desde la plantilla XLSX propia. No pertenece a un período: crea la
 * cuenta DOCENTE, su perfil y la credencial temporal (cédula, cambio obligatorio) en una sola
 * transacción SERIALIZABLE; los registros idénticos existentes se omiten.
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
    // La clave temporal inicial es la cédula; la credencial exige cambiarla en el primer acceso.
    const tempHashes = new Map<string, string>();
    for (const row of rows) tempHashes.set(row.email, await createTemporaryCredentialHash(row.cedula));
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
        const created = await this.createRows(manager, rows, tempHashes, record, now);
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
        await this.auditoria.registrar(manager, { actor: record.solicitada_por, accion: 'COMPLETAR_IMPORTACION_DOCENTES', entidad_tipo: 'lote_importacion', entidad_id: lot.id, valores_anteriores: null, valores_nuevos: { preparacion_id: record.id, total_filas: rows.length, filas_ok: lot.filas_ok, filas_error: 0, docentes_creados: created, omitidos: rows.length - created }, ip_origen: record.ip_origen });
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

  /** Crea cuenta, perfil y credencial faltantes; devuelve cuántos perfiles docentes se crearon. */
  private async createRows(manager: EntityManager, rows: DocenteExcelRow[], tempHashes: Map<string, string>, record: PreparacionImportacion, now: Date): Promise<number> {
    const users = manager.getRepository(Usuario);
    const teachers = manager.getRepository(Docente);
    const credentials = manager.getRepository(CredencialUsuario);
    const outboxRepo = manager.getRepository(CorreoSalida);
    let created = 0;
    for (const row of [...rows].sort((left, right) => left.email.localeCompare(right.email))) {
      let user = await users.findOne({ where: { email: row.email }, lock: { mode: 'pessimistic_write' } });
      if (!user) user = await users.save(users.create({ email: row.email, nombres: row.nombres, apellidos: row.apellidos, rol: UsuarioRol.DOCENTE, estado: UsuarioEstado.ACTIVO, id_externo_sso: null, ultimo_acceso: null }));
      const profile = await teachers.findOne({ where: { usuario: { id: user.id } }, lock: { mode: 'pessimistic_write' } });
      if (!profile) {
        const saved = await teachers.save(teachers.create({ usuario: user, cedula: row.cedula, titulo_academico: row.titulo_academico, departamento: row.departamento, habilitado_tutoria: row.habilitado_tutoria }));
        created += 1;
        await this.auditoria.registrar(manager, { actor: record.solicitada_por, accion: 'IMPORTAR_DOCENTE', entidad_tipo: 'docente', entidad_id: saved.id, valores_anteriores: null, valores_nuevos: { usuario_id: user.id, email: user.email, cedula: saved.cedula, titulo_academico: saved.titulo_academico, departamento: saved.departamento, habilitado_tutoria: saved.habilitado_tutoria, preparacion_id: record.id }, ip_origen: record.ip_origen });
      }
      const credential = await credentials.findOne({ where: { usuario_id: user.id }, lock: { mode: 'pessimistic_write' } });
      if (!credential) {
        const expiry = new Date(Date.now() + TEMP_PASSWORD_TTL_MS);
        const hash = tempHashes.get(row.email);
        if (!hash) throw new Error('No se pudo proteger la clave temporal.');
        await credentials.save(credentials.create({ usuario_id: user.id, password_hash: hash, requiere_cambio: true, temporal_expira_en: expiry, version_sesion: 0, actualizada_en: now }));
        await outboxRepo.save(createEncryptedOutbox(manager, user.id, 'ACCESO', row.cedula, expiry, this.encryptionKey));
      }
    }
    return created;
  }

  /** Igual que la importación de estudiantes: conflictos → errores por fila; registros idénticos → se omiten. */
  private async validateExistingRows(rows: DocenteExcelRow[], manager: EntityManager = this.dataSource.manager): Promise<ExcelRowError[]> {
    const errors: ExcelRowError[] = [];
    const userRepo = manager.getRepository(Usuario);
    const teacherRepo = manager.getRepository(Docente);
    for (const row of rows) {
      const account = await userRepo.findOne({ where: { email: row.email } });
      if (account && (account.rol !== UsuarioRol.DOCENTE || account.estado !== UsuarioEstado.ACTIVO || account.nombres !== row.nombres || account.apellidos !== row.apellidos)) {
        errors.push({ fila: row.fila, columna: 'email', mensaje: 'El correo existe con un rol, estado o nombre distinto; requiere revisión administrativa.' });
        continue;
      }
      const byCedula = await teacherRepo.findOne({ where: { cedula: row.cedula }, relations: { usuario: true } });
      if (byCedula && (!account || byCedula.usuario?.id !== account.id)) {
        errors.push({ fila: row.fila, columna: 'cedula', mensaje: 'La cédula ya pertenece a otro docente.' });
        continue;
      }
      if (account) {
        const profile = await teacherRepo.findOne({ where: { usuario: { id: account.id } }, relations: { usuario: true } });
        if (profile && !profileMatches(profile, row)) {
          errors.push({ fila: row.fila, columna: 'cedula', mensaje: 'El perfil docente existente contiene datos distintos; corrígelos mediante la edición del docente.' });
        }
      }
    }
    return errors;
  }
}
