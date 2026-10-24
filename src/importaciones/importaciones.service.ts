import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import type { AppEnvironment } from '../config/environment.js';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { CondicionIngreso } from '../habilitados/enums/condicion-ingreso.enum.js';
import { EstudianteHabilitado } from '../habilitados/entities/estudiante-habilitado.entity.js';
import { HabilitadoEstado } from '../habilitados/enums/habilitado-estado.enum.js';
import { HabilitadoOrigen } from '../habilitados/enums/habilitado-origen.enum.js';
import { SituacionIngreso } from '../habilitados/enums/situacion-ingreso.enum.js';
import { LoteImportacion } from './entities/lote-importacion.entity.js';
import { PreparacionImportacion } from './entities/preparacion-importacion.entity.js';
import { PreparacionImportacionEstado as EstadoPreparacion } from './enums/preparacion-importacion-estado.enum.js';
import { LoteImportacionEstado } from './enums/lote-importacion-estado.enum.js';
import { LoteImportacionTipo } from './enums/lote-importacion-tipo.enum.js';
import type { EstudianteExcelRow, ExcelRowError } from './estudiantes-excel.parser.js';
import { parseStudentsXlsx } from './estudiantes-excel.parser.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CorreoSalida } from '../auth/entities/correo-salida.entity.js';
import { CredencialUsuario } from '../auth/entities/credencial-usuario.entity.js';
import { createEncryptedOutbox, createTemporaryCredentialHash, generateOneTimeSecret, readEncryptionKey, TEMP_PASSWORD_TTL_MS } from '../auth/credentials.js';

const PREPARATION_TTL_MS = 12 * 60 * 60 * 1000;

export interface ImportacionResumen {
  id: string;
  periodo_id: string;
  nombre_archivo: string;
  estado: EstadoPreparacion;
  total_filas: number;
  errores: ExcelRowError[];
  vista_previa: EstudianteExcelRow[];
  lote_id: string | null;
  creada_en: Date;
  expira_en: Date;
}

function response(record: PreparacionImportacion): ImportacionResumen {
  return {
    id: record.id, periodo_id: record.periodo.id, nombre_archivo: record.nombre_archivo,
    estado: record.estado, total_filas: record.total_filas,
    errores: (record.errores as ExcelRowError[] | null) ?? [],
    vista_previa: (record.filas as EstudianteExcelRow[] | null) ?? [],
    lote_id: record.lote?.id ?? null, creada_en: record.creada_en, expira_en: record.expira_en,
  };
}

@Injectable()
export class ImportacionesService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private dispatching = false;
  private readonly encryptionKey: string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: AlmacenamientoService,
    private readonly auditoria: AuditoriaService,
    private readonly config: ConfigService<AppEnvironment, true>,
    @InjectQueue('importaciones') private readonly queue: Queue,
  ) {
    const keyPath = config.get('OUTBOX_ENCRYPTION_KEY_PATH', { infer: true });
    this.encryptionKey = keyPath ? readEncryptionKey(keyPath) : '';
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.dispatchPending(), 5000);
    this.timer.unref();
    void this.dispatchPending();
  }

  async onModuleDestroy(): Promise<void> { if (this.timer) clearInterval(this.timer); }

  async submit(periodId: string, actor: Usuario, originalName: string, buffer: Buffer, ip: string | null): Promise<{ id: string; estado: EstadoPreparacion }> {
    await this.assertDraftPeriod(periodId);
    const filename = originalName.replaceAll('\\', '/').split('/').at(-1) ?? 'estudiantes.xlsx';
    const key = await this.storage.savePrivate(buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    let record: PreparacionImportacion;
    try {
      record = await this.dataSource.transaction(async (manager) => {
        const preparationRepo = manager.getRepository(PreparacionImportacion);
        const created = await preparationRepo.save(preparationRepo.create({
          periodo: { id: periodId }, solicitada_por: actor, lote: null,
          nombre_archivo: filename.slice(0, 200), ruta_almacenamiento: key,
          sha256: createHash('sha256').update(buffer).digest('hex'),
          estado: EstadoPreparacion.VALIDANDO, total_filas: 0, filas: null, errores: null,
          ip_origen: ip,
          expira_en: new Date(Date.now() + PREPARATION_TTL_MS),
        }));
        await this.auditoria.registrar(manager, {
          actor, accion: 'SOLICITAR_IMPORTACION_ESTUDIANTES', entidad_tipo: 'preparacion_importacion', entidad_id: created.id,
          valores_anteriores: null, valores_nuevos: { periodo_id: periodId, sha256: created.sha256, nombre_archivo: created.nombre_archivo }, ip_origen: ip,
        });
        return created;
      });
    } catch (error: unknown) {
      await this.storage.removePrivate(key).catch(() => undefined);
      throw error;
    }
    await this.queue.add('validar-excel', { id: record.id }, { jobId: `importacion-validar-${record.id}`, attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true, removeOnFail: false }).catch(() => undefined);
    return { id: record.id, estado: record.estado };
  }

  async validateFile(id: string): Promise<void> {
    const repository = this.dataSource.getRepository(PreparacionImportacion);
    const record = await repository.findOne({ where: { id }, relations: { periodo: true } });
    if (!record || record.estado !== EstadoPreparacion.VALIDANDO || record.expira_en <= new Date()) return;
    try {
      await this.assertDraftPeriod(record.periodo.id);
      const buffer = await this.storage.readPrivate(record.ruta_almacenamiento);
      const parsed = await parseStudentsXlsx(buffer);
      if (parsed.sha256 !== record.sha256) throw new ConflictException('El archivo cambió desde que se envió a validar.');
      const databaseErrors = await this.validateExistingRows(parsed.rows, record.periodo.id);
      const errors = [...parsed.errors, ...databaseErrors];
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

  async get(periodId: string, id: string): Promise<ImportacionResumen> {
    const record = await this.dataSource.getRepository(PreparacionImportacion).findOne({ where: { id, periodo: { id: periodId } }, relations: { periodo: true, lote: true } });
    if (!record) throw new NotFoundException('No existe la preparación indicada para el período.');
    if (record.expira_en <= new Date() && [EstadoPreparacion.VALIDANDO, EstadoPreparacion.LISTA, EstadoPreparacion.INVALIDA].includes(record.estado)) throw new GoneException('La preparación venció; vuelve a cargar el archivo.');
    return response(record);
  }

  async confirm(periodId: string, id: string, actor: Usuario, ip: string | null): Promise<{ id: string; estado: EstadoPreparacion }> {
    const result = await this.dataSource.transaction(async (manager) => {
      const period = await manager.getRepository(PeriodoTitulacion).findOne({ where: { id: periodId }, lock: { mode: 'pessimistic_write' } });
      if (!period) throw new NotFoundException('No existe el período indicado.');
      if (period.estado !== PeriodoEstado.BORRADOR) throw new ConflictException('Solo se puede importar en períodos BORRADOR.');
      const record = await manager.getRepository(PreparacionImportacion).findOne({ where: { id, periodo: { id: periodId } }, relations: { periodo: true }, lock: { mode: 'pessimistic_write' } });
      if (!record) throw new NotFoundException('No existe la preparación indicada para el período.');
      if (record.estado === EstadoPreparacion.COMPLETADA) throw new ConflictException('La importación ya fue completada.');
      if (record.estado === EstadoPreparacion.LISTA) {
        if (record.expira_en <= new Date() || !Array.isArray(record.filas) || !Array.isArray(record.errores) || record.errores.length > 0) throw new ConflictException('La vista previa venció o tiene errores; vuelve a cargar el archivo.');
        record.estado = EstadoPreparacion.EN_COLA;
        await manager.getRepository(PreparacionImportacion).save(record);
        await this.auditoria.registrar(manager, {
          actor, accion: 'CONFIRMAR_IMPORTACION_ESTUDIANTES', entidad_tipo: 'preparacion_importacion', entidad_id: record.id,
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
    await this.queue.add('importar-estudiantes', { id: result.id }, { jobId, attempts: 3, backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: true, removeOnFail: false });
    return result;
  }

  async importConfirmed(id: string): Promise<void> {
    const prepRepo = this.dataSource.getRepository(PreparacionImportacion);
    const record = await prepRepo.findOne({ where: { id }, relations: { periodo: true, solicitada_por: true } });
    if (!record || record.estado !== EstadoPreparacion.EN_COLA || record.expira_en <= new Date()) return;
    if (!Array.isArray(record.filas) || !Array.isArray(record.errores) || record.errores.length > 0) throw new ConflictException('La preparación ya no es válida.');
    const rows = record.filas as EstudianteExcelRow[];
    const buffer = await this.storage.readPrivate(record.ruta_almacenamiento);
    if (createHash('sha256').update(buffer).digest('hex') !== record.sha256) throw new ConflictException('El archivo guardado no coincide con la vista previa validada.');
    const access = await Promise.all(rows.map(async (row) => ({ row, temp: generateOneTimeSecret() })));
    const tempHashes = new Map<string, string>();
    for (const item of access) tempHashes.set(item.row.email, await createTemporaryCredentialHash(item.temp));
    try {
      const wasImported = await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
        const period = await manager.getRepository(PeriodoTitulacion).findOne({ where: { id: record.periodo.id }, lock: { mode: 'pessimistic_write' } });
        if (!period) throw new NotFoundException('No existe el período de la importación.');
        if (period.estado !== PeriodoEstado.BORRADOR) throw new ConflictException('El período dejó de estar en borrador; no se creó ningún registro.');
        const preparation = await manager.getRepository(PreparacionImportacion).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
        if (!preparation || preparation.estado !== EstadoPreparacion.EN_COLA) return false;
        const currentErrors = await this.validateExistingRows(rows, period.id, manager);
        if (currentErrors.length > 0) throw new ConflictException('Los datos cambiaron desde la vista previa; vuelve a validar el archivo.');
        const now = new Date();
        const loteRepo = manager.getRepository(LoteImportacion);
        const lot = await loteRepo.save(loteRepo.create({
          periodo: period, ejecutado_por: record.solicitada_por, tipo: LoteImportacionTipo.ESTUDIANTES,
          nombre_archivo: record.nombre_archivo, ruta_almacenamiento: record.ruta_almacenamiento,
          estado: LoteImportacionEstado.EN_PROCESO, total_filas: rows.length, filas_ok: 0, filas_error: 0,
          errores: null, fecha_inicio: now, fecha_fin: null,
        }));
        const users = manager.getRepository(Usuario);
        const students = manager.getRepository(Estudiante);
        const enabledRepo = manager.getRepository(EstudianteHabilitado);
        const credentials = manager.getRepository(CredencialUsuario);
        const outboxRepo = manager.getRepository(CorreoSalida);
        for (const row of [...rows].sort((left, right) => left.email.localeCompare(right.email))) {
          let user = await users.findOne({ where: { email: row.email }, lock: { mode: 'pessimistic_write' } });
          if (!user) user = await users.save(users.create({ email: row.email, nombres: row.nombres, apellidos: row.apellidos, rol: UsuarioRol.ESTUDIANTE, estado: UsuarioEstado.ACTIVO, id_externo_sso: null, ultimo_acceso: null }));
          let profile = await students.findOne({ where: { usuario: { id: user.id } }, lock: { mode: 'pessimistic_write' } });
          if (!profile) profile = await students.save(students.create({ usuario: user, cedula: row.cedula, matricula: row.matricula, carrera: row.carrera, nivel: row.nivel }));
          let habilitation = await enabledRepo.findOne({ where: { periodo: { id: period.id }, estudiante: { id: profile.id } }, lock: { mode: 'pessimistic_write' } });
          if (!habilitation) {
            const regular = row.condicion_ingreso === CondicionIngreso.REGULAR;
            habilitation = await enabledRepo.save(enabledRepo.create({
              periodo: period, estudiante: profile, origen: HabilitadoOrigen.IMPORTACION, lote_importacion: lot,
              estado: HabilitadoEstado.HABILITADO, condicion_ingreso: row.condicion_ingreso,
              requisito_pendiente: row.requisito_pendiente,
              situacion_ingreso: regular ? SituacionIngreso.ADMITIDO : SituacionIngreso.PENDIENTE,
              fecha_habilitacion: now, fecha_resolucion_ingreso: regular ? now : null,
              resuelto_por: regular ? record.solicitada_por : null, observacion_ingreso: null,
            }));
            await this.auditoria.registrar(manager, { actor: record.solicitada_por, accion: 'IMPORTAR_HABILITACION', entidad_tipo: 'estudiante_habilitado', entidad_id: habilitation.id, valores_anteriores: null, valores_nuevos: { periodo_id: period.id, estudiante_id: profile.id, lote_importacion_id: lot.id, condicion_ingreso: row.condicion_ingreso, situacion_ingreso: habilitation.situacion_ingreso, origen: HabilitadoOrigen.IMPORTACION }, ip_origen: record.ip_origen });
          }
          const credential = await credentials.findOne({ where: { usuario_id: user.id }, lock: { mode: 'pessimistic_write' } });
          if (!credential) {
            const password = access.find((item) => item.row.email === row.email)?.temp;
            if (!password) throw new Error('No se pudo generar una clave temporal.');
            const expiry = new Date(Date.now() + TEMP_PASSWORD_TTL_MS);
            const hash = tempHashes.get(row.email);
            if (!hash) throw new Error('No se pudo proteger la clave temporal.');
            await credentials.save(credentials.create({ usuario_id: user.id, password_hash: hash, requiere_cambio: true, temporal_expira_en: expiry, version_sesion: 0, actualizada_en: now }));
            await outboxRepo.save(createEncryptedOutbox(manager, user.id, 'ACCESO', password, expiry, this.encryptionKey));
          }
        }
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
        await this.auditoria.registrar(manager, { actor: record.solicitada_por, accion: 'COMPLETAR_IMPORTACION_ESTUDIANTES', entidad_tipo: 'lote_importacion', entidad_id: lot.id, valores_anteriores: null, valores_nuevos: { preparacion_id: record.id, periodo_id: period.id, total_filas: rows.length, filas_ok: lot.filas_ok, filas_error: 0 }, ip_origen: record.ip_origen });
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

  async dispatchPending(): Promise<void> {
    if (this.dispatching || !this.dataSource.isInitialized) return;
    this.dispatching = true;
    try {
      const pending = await this.dataSource.getRepository(PreparacionImportacion).find({ where: [{ estado: EstadoPreparacion.VALIDANDO }, { estado: EstadoPreparacion.EN_COLA }], order: { creada_en: 'ASC' }, take: 25 });
      for (const item of pending) {
        await this.queue.add(item.estado === EstadoPreparacion.VALIDANDO ? 'validar-excel' : 'importar-estudiantes', { id: item.id }, { jobId: `importacion-${item.estado === EstadoPreparacion.VALIDANDO ? 'validar' : 'confirmar'}-${item.id}`, attempts: 3, backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: true, removeOnFail: false });
      }
    } catch {
      // Los estados duraderos en PostgreSQL permiten retomar el despacho en el siguiente ciclo.
    } finally { this.dispatching = false; }
  }

  private async assertDraftPeriod(id: string): Promise<void> {
    const period = await this.dataSource.getRepository(PeriodoTitulacion).findOneBy({ id });
    if (!period) throw new NotFoundException('No existe el período indicado.');
    if (period.estado !== PeriodoEstado.BORRADOR) throw new ConflictException('Solo se pueden importar estudiantes en un período BORRADOR.');
  }

  private async validateExistingRows(rows: EstudianteExcelRow[], periodId: string, manager: EntityManager = this.dataSource.manager): Promise<ExcelRowError[]> {
    const errors: ExcelRowError[] = [];
    const userRepo = manager.getRepository(Usuario);
    const studentRepo = manager.getRepository(Estudiante);
    const enabledRepo = manager.getRepository(EstudianteHabilitado);
    for (const row of rows) {
      const account = await userRepo.findOne({ where: { email: row.email }, relations: { } });
      if (account && (account.rol !== UsuarioRol.ESTUDIANTE || account.estado !== UsuarioEstado.ACTIVO || account.nombres !== row.nombres || account.apellidos !== row.apellidos)) {
        errors.push({ fila: row.fila, columna: 'email', mensaje: 'El correo existe con un rol, estado o nombre distinto; requiere revisión administrativa.' });
        continue;
      }
      const byCedula = await studentRepo.findOne({ where: { cedula: row.cedula }, relations: { usuario: true } });
      const byMatricula = await studentRepo.findOne({ where: { matricula: row.matricula }, relations: { usuario: true } });
      if ((byCedula && (!account || byCedula.usuario?.id !== account.id)) || (byMatricula && (!account || byMatricula.usuario?.id !== account.id))) {
        errors.push({ fila: row.fila, columna: byCedula ? 'cedula' : 'matricula', mensaje: 'El identificador ya pertenece a otra cuenta.' });
        continue;
      }
      if (account) {
        const profile = await studentRepo.findOne({ where: { usuario: { id: account.id } }, relations: { usuario: true } });
        if (profile && (profile.cedula !== row.cedula || profile.matricula !== row.matricula || profile.carrera !== row.carrera || profile.nivel !== row.nivel)) {
          errors.push({ fila: row.fila, columna: 'matricula', mensaje: 'El perfil existente contiene datos distintos; corrígelos mediante el proceso administrativo.' });
          continue;
        }
        if (profile) {
          const old = await enabledRepo.findOneBy({ periodo: { id: periodId }, estudiante: { id: profile.id } });
          if (old && (old.estado !== HabilitadoEstado.HABILITADO || old.condicion_ingreso !== row.condicion_ingreso || old.requisito_pendiente !== row.requisito_pendiente || old.situacion_ingreso !== (row.condicion_ingreso === CondicionIngreso.REGULAR ? SituacionIngreso.ADMITIDO : SituacionIngreso.PENDIENTE))) {
            errors.push({ fila: row.fila, columna: 'condicion_ingreso', mensaje: 'La habilitación del período existe con datos o una resolución distinta; no se sobrescribirá.' });
          }
        }
      }
    }
    return errors;
  }
}
