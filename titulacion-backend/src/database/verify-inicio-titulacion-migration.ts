import { randomBytes } from 'node:crypto';
import { QueryFailedError } from 'typeorm';
import { loadEnvironment } from '../config/load-environment.js';
import { createDatabaseOptions } from './database.options.js';
import { DatabaseDataSource } from './database-data-source.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { InicioTitulacionService } from '../periodos/inicio-titulacion.service.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { CreateUsuario20261002000000 } from './migrations/20261002000000-CreateUsuario.js';
import { CreateEstudianteDocente20261002010000 } from './migrations/20261002010000-CreateEstudianteDocente.js';
import { CreatePeriodoTitulacion20261002020000 } from './migrations/20261002020000-CreatePeriodoTitulacion.js';
import { CreateHabilitados20261002030000 } from './migrations/20261002030000-CreateHabilitados.js';
import { StartPeriodoTitulacion20261016000000 } from './migrations/20261016000000-StartPeriodoTitulacion.js';

const schema = `test_inicio_titulacion_${randomBytes(8).toString('hex')}`;
let adminDataSource: DatabaseDataSource | undefined;
let isolatedDataSource: DatabaseDataSource | undefined;
let schemaCreated = false;
let verificationStep = 'conexión y migraciones previas';

function identifier(): string {
  if (!/^test_inicio_titulacion_[a-f0-9]{16}$/.test(schema)) throw new Error('Esquema temporal inválido.');
  return `"${schema}"`;
}

function code(error: unknown): string | undefined {
  return error instanceof QueryFailedError
    ? (error.driverError as { code?: string }).code
    : undefined;
}

async function expectCheckFailure(query: string, params: unknown[] = []): Promise<void> {
  try {
    await isolatedDataSource!.query(query, params);
  } catch (error: unknown) {
    if (code(error) === '23514') return;
    throw error;
  }
  throw new Error('PostgreSQL permitió una operación que debía rechazar.');
}

async function createPeriod(codeValue: string, state: string, start = new Date(Date.now() - 60_000)): Promise<string> {
  const rows = await isolatedDataSource!.query(`
    INSERT INTO ${identifier()}."periodo_titulacion"
      ("codigo", "nombre", "fecha_inicio_postulacion", "fecha_fin_postulacion", "fecha_inicio_titulacion", "estado", "max_integrantes_default")
    VALUES ($1, 'Período de verificación', now() - interval '2 days', now() - interval '1 day', $2, $3, 5)
    RETURNING "id"
  `, [codeValue, start, state]) as Array<{ id: string }>;
  return rows[0].id;
}

async function createStudent(index: number): Promise<string> {
  const users = await isolatedDataSource!.query(`
    INSERT INTO ${identifier()}."usuario" ("email", "nombres", "apellidos", "rol", "id_externo_sso")
    VALUES ($1, $2, 'Verificación', 'ESTUDIANTE', $3) RETURNING "id"
  `, [`student${index}@verification.example`, `Estudiante ${index}`, `verify-student-${index}`]) as Array<{ id: string }>;
  const students = await isolatedDataSource!.query(`
    INSERT INTO ${identifier()}."estudiante" ("usuario_id", "cedula", "matricula", "carrera", "nivel")
    VALUES ($1, $2, $3, 'Sistemas', 5) RETURNING "id"
  `, [users[0].id, `01020304${String(index).padStart(2, '0')}`, `VERIFY-${index}`]) as Array<{ id: string }>;
  return students[0].id;
}

async function createPending(periodId: string, studentId: string): Promise<void> {
  await isolatedDataSource!.query(`
    INSERT INTO ${identifier()}."estudiante_habilitado"
      ("periodo_id", "estudiante_id", "origen", "estado", "condicion_ingreso", "requisito_pendiente", "situacion_ingreso")
    VALUES ($1, $2, 'MANUAL', 'SUSPENDIDO', 'CONDICIONADO', 'Pendiente de prueba', 'PENDIENTE')
  `, [periodId, studentId]);
}

async function verify(): Promise<void> {
  const options = createDatabaseOptions(loadEnvironment());
  adminDataSource = new DatabaseDataSource({ ...options, schema: 'public', entities: [], migrations: [] });
  await adminDataSource.initialize();
  await adminDataSource.query(`CREATE SCHEMA ${identifier()}`);
  schemaCreated = true;

  isolatedDataSource = new DatabaseDataSource({
    ...options,
    schema,
    entities: [PeriodoTitulacion, Usuario],
    migrations: [
      CreateUsuario20261002000000,
      CreateEstudianteDocente20261002010000,
      CreatePeriodoTitulacion20261002020000,
      CreateHabilitados20261002030000,
    ],
  });
  await isolatedDataSource.initialize();
  await isolatedDataSource.runMigrations({ transaction: 'all' });

  verificationStep = 'preparación de datos y comprobación de migración incompatible';
  const adminRows = await isolatedDataSource.query(`
    INSERT INTO ${identifier()}."usuario" ("email", "nombres", "apellidos", "rol", "id_externo_sso")
    VALUES ('admin@verification.example', 'Admin', 'Verificación', 'ADMIN', 'verify-admin') RETURNING "id"
  `) as Array<{ id: string }>;
  const firstStudent = await createStudent(1);
  const secondStudent = await createStudent(2);
  const inconsistentPeriod = await createPeriod('INCONSISTENT', 'EN_CURSO');
  // Insert before installing protections to emulate data that predates this migration.
  await createPending(inconsistentPeriod, firstStudent);
  const seededInconsistent = await isolatedDataSource.query(`
    SELECT count(*)::int AS total FROM ${identifier()}."periodo_titulacion" p
    JOIN ${identifier()}."estudiante_habilitado" h ON h."periodo_id" = p."id"
    WHERE p."estado" = 'EN_CURSO' AND h."condicion_ingreso" = 'CONDICIONADO' AND h."situacion_ingreso" = 'PENDIENTE'
  `) as Array<{ total: number }>;
  const migration = new StartPeriodoTitulacion20261016000000();
  const runner = isolatedDataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  let refusedInconsistentData = false;
  let firstMigrationError = 'none';
  try {
    await migration.up(runner);
  } catch (error: unknown) {
    firstMigrationError = error instanceof Error ? error.message : 'unknown';
    refusedInconsistentData = error instanceof Error && error.message.includes('condicionados pendientes');
    await runner.rollbackTransaction().catch(() => undefined);
  } finally {
    await runner.release();
  }
  if (!refusedInconsistentData) throw new Error(`La migración no detectó períodos EN_CURSO inconsistentes (filas preparadas: ${seededInconsistent[0]?.total ?? 0}; error: ${firstMigrationError}).`);
  await isolatedDataSource.query(`DELETE FROM ${identifier()}."estudiante_habilitado"`);
  await isolatedDataSource.query(`DELETE FROM ${identifier()}."periodo_titulacion"`);
  verificationStep = 'instalación de triggers';
  const installRunner = isolatedDataSource.createQueryRunner();
  await installRunner.connect();
  await installRunner.startTransaction();
  try {
    await migration.up(installRunner);
    await installRunner.commitTransaction();
  } catch (error: unknown) {
    await installRunner.rollbackTransaction();
    throw error;
  } finally {
    await installRunner.release();
  }

  verificationStep = 'rechazo de estados y fechas incompatibles';
  const pendingPeriod = await createPeriod('PENDING-BLOCK', 'POSTULACION_CERRADA');
  await createPending(pendingPeriod, firstStudent);
  await expectCheckFailure(`UPDATE ${identifier()}."periodo_titulacion" SET "estado" = 'EN_CURSO' WHERE "id" = $1`, [pendingPeriod]);

  const futurePeriod = await createPeriod('FUTURE-BLOCK', 'POSTULACION_CERRADA', new Date(Date.now() + 60_000));
  await expectCheckFailure(`UPDATE ${identifier()}."periodo_titulacion" SET "estado" = 'EN_CURSO' WHERE "id" = $1`, [futurePeriod]);
  await expectCheckFailure(`INSERT INTO ${identifier()}."periodo_titulacion" ("codigo", "nombre", "fecha_inicio_postulacion", "fecha_fin_postulacion", "fecha_inicio_titulacion", "estado", "max_integrantes_default") VALUES ('DIRECT-INSERT', 'Inválido', now() - interval '2 days', now() - interval '1 day', now() - interval '1 hour', 'EN_CURSO', 5)`);

  const admittedAdmin = adminRows[0].id;
  await isolatedDataSource.query(`
    UPDATE ${identifier()}."estudiante_habilitado"
    SET "situacion_ingreso" = 'ADMITIDO', "fecha_resolucion_ingreso" = now(), "resuelto_por_id" = $2
    WHERE "periodo_id" = $1
  `, [pendingPeriod, admittedAdmin]);
  verificationStep = 'inicio sin pendientes y rechazo de nuevas habilitaciones';
  await isolatedDataSource.query(`UPDATE ${identifier()}."periodo_titulacion" SET "estado" = 'EN_CURSO' WHERE "id" = $1`, [pendingPeriod]);
  await expectCheckFailure(`
    INSERT INTO ${identifier()}."estudiante_habilitado"
      ("periodo_id", "estudiante_id", "origen", "estado", "condicion_ingreso", "requisito_pendiente", "situacion_ingreso")
    VALUES ($1, $2, 'MANUAL', 'HABILITADO', 'CONDICIONADO', 'Pendiente', 'PENDIENTE')
  `, [pendingPeriod, secondStudent]);

  verificationStep = 'carrera entre inicio e inserción de condicionado';
  const concurrentPeriod = await createPeriod('RACE', 'POSTULACION_CERRADA');
  const outcomes = await Promise.allSettled([
    isolatedDataSource.query(`UPDATE ${identifier()}."periodo_titulacion" SET "estado" = 'EN_CURSO' WHERE "id" = $1`, [concurrentPeriod]),
    createPending(concurrentPeriod, secondStudent),
  ]);
  const concurrentPeriodRows = await isolatedDataSource.query(`SELECT "estado" FROM ${identifier()}."periodo_titulacion" WHERE "id" = $1`, [concurrentPeriod]) as Array<{ estado: string }>;
  const concurrentPendingRows = await isolatedDataSource.query(`SELECT count(*)::int AS total FROM ${identifier()}."estudiante_habilitado" WHERE "periodo_id" = $1 AND "condicion_ingreso" = 'CONDICIONADO' AND "situacion_ingreso" = 'PENDIENTE'`, [concurrentPeriod]) as Array<{ total: number }>;
  if (concurrentPeriodRows[0].estado === 'EN_CURSO' && Number(concurrentPendingRows[0].total) > 0) {
    throw new Error('La carrera permitió un período EN_CURSO con condicionados pendientes.');
  }
  if (outcomes.every((result) => result.status === 'rejected')) throw new Error('La prueba de concurrencia no permitió una operación válida.');

  verificationStep = 'rollback transaccional ante fallo de auditoría';
  const rollbackPeriod = await createPeriod('AUDIT-ROLLBACK', 'POSTULACION_CERRADA');
  const failingAudit = {
    registrar: async () => { throw new Error('fallo de auditoría provocado'); },
  } as unknown as AuditoriaService;
  const startService = new InicioTitulacionService(isolatedDataSource, failingAudit);
  try {
    await startService.iniciar(rollbackPeriod, { id: adminRows[0].id } as Usuario, null);
    throw new Error('El inicio persistió a pesar del fallo de auditoría.');
  } catch (error: unknown) {
    if (!(error instanceof Error) || error.message === 'El inicio persistió a pesar del fallo de auditoría.') throw error;
  }
  const rollbackState = await isolatedDataSource.query(`SELECT "estado" FROM ${identifier()}."periodo_titulacion" WHERE "id" = $1`, [rollbackPeriod]) as Array<{ estado: string }>;
  if (rollbackState[0]?.estado !== 'POSTULACION_CERRADA') throw new Error('El fallo de auditoría no revirtió el cambio de estado.');

  verificationStep = 'reversión de protecciones sin pérdida de datos';
  const beforeRollback = await isolatedDataSource.query(`SELECT count(*)::int AS total FROM ${identifier()}."estudiante_habilitado"`) as Array<{ total: number }>;
  const downRunner = isolatedDataSource.createQueryRunner();
  await downRunner.connect();
  await downRunner.startTransaction();
  try {
    await migration.down(downRunner);
    await downRunner.commitTransaction();
  } catch (error: unknown) {
    await downRunner.rollbackTransaction();
    throw error;
  } finally {
    await downRunner.release();
  }
  const afterRollback = await isolatedDataSource.query(`SELECT count(*)::int AS total FROM ${identifier()}."estudiante_habilitado"`) as Array<{ total: number }>;
  if (Number(beforeRollback[0].total) !== Number(afterRollback[0].total)) throw new Error('La reversión eliminó información histórica.');
}

async function cleanup(): Promise<void> {
  let failed = false;
  if (isolatedDataSource?.isInitialized) await isolatedDataSource.destroy().catch(() => { failed = true; });
  if (schemaCreated && adminDataSource?.isInitialized) await adminDataSource.query(`DROP SCHEMA ${identifier()} CASCADE`).catch(() => { failed = true; });
  if (adminDataSource?.isInitialized) await adminDataSource.destroy().catch(() => { failed = true; });
  if (failed) throw new Error('No se pudo limpiar el esquema temporal.');
}

let verified = false;
try {
  await verify();
  verified = true;
} catch (error: unknown) {
  console.error(`Falló la verificación aislada del inicio de titulación (${verificationStep}). No se modificaron public ni local_demo.`, error instanceof Error ? error.message : 'error desconocido');
  process.exitCode = 1;
} finally {
  await cleanup().catch(() => {
    console.error('No se pudo limpiar el esquema temporal.');
    process.exitCode = 1;
  });
}
if (verified && process.exitCode !== 1) console.info('Migración, protecciones PostgreSQL, concurrencia y reversión de inicio de titulación verificadas.');
