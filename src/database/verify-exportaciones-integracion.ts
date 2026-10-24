import { randomBytes, createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { ArchivoLimpiezaService } from '../almacenamiento/archivo-limpieza.service.js';
import { ArchivoPendiente } from '../almacenamiento/entities/archivo-pendiente.entity.js';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service.js';
import { loadEnvironment } from '../config/load-environment.js';
import type { AppEnvironment } from '../config/environment.js';
import { createDatabaseOptions } from './database.options.js';
import { DatabaseDataSource } from './database-data-source.js';
import { SolicitudExportacion } from '../exportaciones/entities/solicitud-exportacion.entity.js';
import { ExportacionEstado } from '../exportaciones/enums/exportacion-estado.enum.js';
import { ExportacionFormato } from '../exportaciones/enums/exportacion-formato.enum.js';
import { ExportacionTipo } from '../exportaciones/enums/exportacion-tipo.enum.js';
import { ExportacionesService, type ExportacionJob } from '../exportaciones/exportaciones.service.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { ReportesService } from '../reportes/reportes.service.js';

const suffix = randomBytes(8).toString('hex');
const schemaName = `test_export_flow_${suffix}`;
const queueName = `test-export-flow-${suffix}`;
let admin: DatabaseDataSource | undefined;
let isolated: DatabaseDataSource | undefined;
let queue: Queue<ExportacionJob> | undefined;
let storage: AlmacenamientoService | undefined;
let schemaCreated = false;
const objectKeys: string[] = [];
let step = 'configuración';

function quoteSchema(): string {
  if (!/^test_export_flow_[a-f0-9]{16}$/.test(schemaName)) throw new Error('Esquema temporal inválido.');
  return `"${schemaName}"`;
}

async function verify(): Promise<void> {
  const env = loadEnvironment();
  if (!env.S3_BUCKET || !env.S3_ENDPOINT) throw new Error('Configura S3_ENDPOINT y S3_BUCKET para la prueba integrada.');
  const base = createDatabaseOptions(env);
  admin = new DatabaseDataSource({ ...base, schema: 'public', entities: [], migrations: [] });
  await admin.initialize();
  await admin.query(`CREATE SCHEMA ${quoteSchema()}`); schemaCreated = true;

  isolated = new DatabaseDataSource({
    ...base,
    schema: schemaName,
  });
  await isolated.initialize();
  await isolated.runMigrations({ transaction: 'all' });

  step = 'preparar identidad y período temporales';
  const userRepo = isolated.getRepository(Usuario);
  const actor = await userRepo.save(userRepo.create({
    email: `admin-${suffix}@verification.example`, nombres: 'Admin', apellidos: 'Integración',
    rol: UsuarioRol.ADMIN, estado: UsuarioEstado.ACTIVO, id_externo_sso: `verify-${suffix}`, ultimo_acceso: null,
  }));
  const periodRepo = isolated.getRepository(PeriodoTitulacion);
  const period = await periodRepo.save(periodRepo.create({
    codigo: `VERIFY-${suffix.slice(0, 8)}`, nombre: 'Período de verificación de exportaciones',
    fecha_inicio_postulacion: new Date(Date.now() - 86_400_000),
    fecha_fin_postulacion: new Date(Date.now() - 3_600_000),
    fecha_inicio_titulacion: new Date(Date.now() + 86_400_000),
    max_integrantes_default: 4,
  }));

  step = 'conectar Redis y almacenamiento S3';
  const config = new ConfigService<AppEnvironment, true>(env as unknown as Record<string, unknown>);
  storage = new AlmacenamientoService(config);
  const cleanupQueue = { add: async () => undefined } as never;
  const cleanup = new ArchivoLimpiezaService(isolated.getRepository(ArchivoPendiente), cleanupQueue);
  const reports = new ReportesService(isolated);
  queue = new Queue<ExportacionJob>(queueName, {
    connection: { host: env.REDIS_HOST ?? '127.0.0.1', port: env.REDIS_PORT, maxRetriesPerRequest: null },
  });
  await queue.waitUntilReady();
  const service = new ExportacionesService(
    isolated, reports, storage, cleanup, new AuditoriaService(), config,
    isolated.getRepository(SolicitudExportacion), queue,
  );
  let lastFailure = 'sin detalle';
  const serviceWithDiagnostics = service as unknown as {
    recordFailure: (job: ExportacionJob & { reserva_id: string }, cause: unknown) => Promise<void>;
  };
  const recordFailure = serviceWithDiagnostics.recordFailure.bind(service);
  serviceWithDiagnostics.recordFailure = async (job, cause) => {
    lastFailure = cause instanceof Error ? `${cause.name}: ${cause.message}`.slice(0, 240) : 'error no identificado';
    await recordFailure(job, cause);
  };

  step = 'solicitar, encolar, generar y descargar PDF, XLSX y CSV';
  const formats = [ExportacionFormato.PDF, ExportacionFormato.XLSX, ExportacionFormato.CSV];
  for (const format of formats) {
    const submitted = await service.solicitar(period.id, { tipo_reporte: ExportacionTipo.ESTUDIANTES, formato: format, filtros: {} }, actor, null);
    await service.dispatchPending();
    const queued = await isolated.getRepository(SolicitudExportacion).findOneBy({ id: submitted.id });
    if (!queued?.reserva_id || queued.estado !== ExportacionEstado.PROCESANDO) throw new Error(`La cola no reservó el trabajo ${format}.`);
    const job = await queue.getJob(queued.reserva_id);
    if (!job || Object.keys(job.data).sort((left, right) => left.localeCompare(right)).join(',') !== 'ciclo,id') throw new Error('Redis recibió más datos que el identificador y ciclo de exportación.');
    await service.procesar(job.data, job.id!);
    await job.remove();

    const result = await isolated.getRepository(SolicitudExportacion).findOneBy({ id: submitted.id });
    if (!result || result.estado !== ExportacionEstado.LISTO || !result.ruta_almacenamiento || !result.hash_sha256) throw new Error(`No se generó el archivo ${format}; estado=${result?.estado ?? 'ausente'}, intentos=${result?.intentos ?? 'n/a'}, mensaje=${result?.error_sanitizado ?? 'sin detalle'}, causa=${lastFailure}.`);
    objectKeys.push(result.ruta_almacenamiento);
    const bytes = await storage.readPrivateExport(result.ruta_almacenamiento);
    if (createHash('sha256').update(bytes).digest('hex') !== result.hash_sha256) throw new Error(`El hash de ${format} no coincide con el archivo almacenado.`);
    if (format === ExportacionFormato.PDF && bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('El resultado PDF no tiene una cabecera válida.');
    if (format === ExportacionFormato.XLSX && bytes.subarray(0, 2).toString('ascii') !== 'PK') throw new Error('El resultado XLSX no es un contenedor ZIP válido.');
    if (format === ExportacionFormato.CSV && !bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) throw new Error('El resultado CSV no incluye UTF-8 BOM.');
    const download = await service.descarga(period.id, result.id, actor);
    if (!download.url.startsWith(env.S3_ENDPOINT) || download.expira_en.getTime() > result.expira_en!.getTime()) throw new Error(`La URL temporal de ${format} no tiene los límites esperados.`);
  }
}

try {
  await verify();
  process.stdout.write('exportaciones:verify-integracion completado: Redis, reportes, firmas S3 y los tres formatos verificados.\n');
} catch (error: unknown) {
  process.stderr.write(`Falló exportaciones:verify-integracion durante ${step}: ${error instanceof Error ? error.message : 'error no identificado'}.\n`);
  process.exitCode = 1;
} finally {
  if (storage) await Promise.all(objectKeys.map((key) => storage!.removePrivate(key).catch(() => undefined)));
  await queue?.obliterate({ force: true }).catch(() => undefined);
  await queue?.close().catch(() => undefined);
  await isolated?.destroy().catch(() => undefined);
  if (schemaCreated) await admin?.query(`DROP SCHEMA IF EXISTS ${quoteSchema()} CASCADE`).catch(() => undefined);
  await admin?.destroy().catch(() => undefined);
  await storage?.onModuleDestroy();
}
