import { randomBytes } from 'node:crypto';
import { QueryFailedError } from 'typeorm';
import { loadEnvironment } from '../config/load-environment.js';
import { createDatabaseOptions } from './database.options.js';
import { DatabaseDataSource } from './database-data-source.js';
import { ArchivoPeriodoService } from '../periodos/archivo-periodo.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { ArchivePeriodo20261018100000 } from './migrations/20261018100000-ArchivePeriodo.js';

const schema = `test_archive_${randomBytes(8).toString('hex')}`;
const q = `"${schema}"`;
let admin: DatabaseDataSource | undefined;
let db: DatabaseDataSource | undefined;
let created = false;
let step = 'inicialización';

function uuid(): string {
  const hex = randomBytes(16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function code(error: unknown): string | undefined {
  return error instanceof QueryFailedError ? (error.driverError as { code?: string }).code : undefined;
}

async function expectCheckFailure(action: () => Promise<unknown>): Promise<void> {
  try { await action(); } catch (error: unknown) { if (code(error) === '23514') return; throw error; }
  throw new Error('PostgreSQL permitió una escritura que debía rechazar.');
}

async function addPeriod(id: string, codeValue: string, state: string): Promise<void> {
  const initial = state === 'EN_CURSO' || state === 'ARCHIVADO' ? 'POSTULACION_CERRADA' : state;
  await db!.query(`INSERT INTO ${q}."periodo_titulacion" ("id","codigo","nombre","fecha_inicio_postulacion","fecha_fin_postulacion","fecha_inicio_titulacion","estado","max_integrantes_default") VALUES ($1,$2,'Período verificador',now()-interval '3 days',now()-interval '2 days',now()-interval '1 day',$3,4)`, [id, codeValue, initial]);
  if (state !== initial) await db!.query(`UPDATE ${q}."periodo_titulacion" SET "estado"=$2 WHERE "id"=$1`, [id, state]);
}

async function verify(): Promise<void> {
  const options = createDatabaseOptions(loadEnvironment());
  admin = new DatabaseDataSource({ ...options, schema: 'public', entities: [], migrations: [] });
  await admin.initialize();
  if (!/^test_archive_[a-f0-9]{16}$/.test(schema)) throw new Error('Nombre del esquema temporal inválido.');
  await admin.query(`CREATE SCHEMA ${q}`); created = true;
  db = new DatabaseDataSource({ ...options, schema, migrations: options.migrations });
  await db.initialize();
  await db.runMigrations({ transaction: 'all' });

  step = 'preparación de responsable y períodos';
  const actorId = uuid();
  await db.query(`INSERT INTO ${q}."usuario" ("id","email","nombres","apellidos","rol","estado") VALUES ($1,'admin@archive.verify','Admin','Verificación','ADMIN','ACTIVO')`, [actorId]);
  const activeId = uuid();
  await addPeriod(activeId, 'ARCHIVE-ACTIVE', 'EN_CURSO');
  const service = new ArchivoPeriodoService(db, new AuditoriaService());
  const actor = await db.getRepository(Usuario).findOneByOrFail({ id: actorId });

  step = 'transiciones directas y terminalidad PostgreSQL';
  await expectCheckFailure(() => addPeriod(uuid(), 'ARCHIVE-DIRECT', 'ARCHIVADO'));
  const invalidTransitionId = uuid();
  await addPeriod(invalidTransitionId, 'ARCHIVE-INVALID', 'POSTULACION_CERRADA');
  await expectCheckFailure(() => db!.query(`UPDATE ${q}."periodo_titulacion" SET "estado"='ARCHIVADO' WHERE "id"=$1`, [invalidTransitionId]));

  step = 'archivo atómico con auditoría';
  const archived = await service.archivar(activeId, { motivo: 'Verificación de archivo' }, actor, null);
  if (archived.estado !== 'ARCHIVADO') throw new Error('El servicio no archivó el período.');
  const auditRows = await db.query(`SELECT count(*)::int AS total FROM ${q}."auditoria" WHERE "entidad_id"=$1 AND "accion"='ARCHIVAR_PERIODO'`, [activeId]) as Array<{ total: number }>;
  if (Number(auditRows[0]?.total) !== 1) throw new Error('No se registró exactamente una auditoría del archivo.');
  await expectCheckFailure(() => db!.query(`UPDATE ${q}."periodo_titulacion" SET "nombre"='cambio' WHERE "id"=$1`, [activeId]));
  await expectCheckFailure(() => db!.query(`UPDATE ${q}."periodo_titulacion" SET "estado"='EN_CURSO' WHERE "id"=$1`, [activeId]));

  step = 'bloqueo de escrituras de dominio después del archivo';
  await expectCheckFailure(() => db!.query(`INSERT INTO ${q}."config_carga_tutorial" ("periodo_id","docente_id","max_trabajos","bloquear_al_superar") VALUES ($1,NULL,3,true)`, [activeId]));

  step = 'archivo concurrente y atomicidad ante fallo de auditoría';
  const concurrentId = uuid();
  await addPeriod(concurrentId, 'ARCHIVE-RACE', 'EN_CURSO');
  const outcomes = await Promise.allSettled([
    service.archivar(concurrentId, { motivo: 'Concurrente A' }, actor, null),
    service.archivar(concurrentId, { motivo: 'Concurrente B' }, actor, null),
  ]);
  if (outcomes.filter((result) => result.status === 'fulfilled').length !== 1) throw new Error('La carrera no produjo exactamente un archivo exitoso.');
  const failingAudit = { registrar: async () => { throw new Error('fallo de auditoría provocado'); } } as unknown as AuditoriaService;
  const rollbackId = uuid();
  await addPeriod(rollbackId, 'ARCHIVE-ROLLBACK', 'EN_CURSO');
  const rollbackService = new ArchivoPeriodoService(db, failingAudit);
  await rollbackService.archivar(rollbackId, { motivo: 'Rollback de prueba' }, actor, null).then(
    () => { throw new Error('El archivo persistió a pesar del fallo de auditoría.'); },
    () => undefined,
  );
  const rollbackRows = await db.query(`SELECT "estado" FROM ${q}."periodo_titulacion" WHERE "id"=$1`, [rollbackId]) as Array<{ estado: string }>;
  if (rollbackRows[0]?.estado !== 'EN_CURSO') throw new Error('El fallo de auditoría no revirtió el archivo.');

  step = 'reversión sin pérdida de datos';
  const before = await db.query(`SELECT count(*)::int AS total FROM ${q}."periodo_titulacion"`) as Array<{ total: number }>;
  const runner = db.createQueryRunner(); await runner.connect(); await runner.startTransaction();
  try { await new ArchivePeriodo20261018100000().down(runner); await runner.commitTransaction(); }
  catch (error: unknown) { await runner.rollbackTransaction(); throw error; }
  finally { await runner.release(); }
  const after = await db.query(`SELECT count(*)::int AS total FROM ${q}."periodo_titulacion"`) as Array<{ total: number }>;
  if (Number(before[0]?.total) !== Number(after[0]?.total)) throw new Error('La reversión eliminó períodos históricos.');
}

try {
  await verify();
  process.stdout.write('db:verify-archivo-periodo completado.\n');
} catch (error: unknown) {
  process.stderr.write(`Falló db:verify-archivo-periodo durante ${step}: ${error instanceof Error ? error.message : 'error no identificado'}.\n`);
  process.exitCode = 1;
} finally {
  await db?.destroy().catch(() => undefined);
  if (created) await admin?.query(`DROP SCHEMA IF EXISTS ${q} CASCADE`).catch(() => undefined);
  await admin?.destroy().catch(() => undefined);
}
