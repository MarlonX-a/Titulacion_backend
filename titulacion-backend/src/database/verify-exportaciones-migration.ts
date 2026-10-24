import { randomBytes } from 'node:crypto';
import { QueryFailedError } from 'typeorm';
import { loadEnvironment } from '../config/load-environment.js';
import { DatabaseDataSource } from './database-data-source.js';
import { createDatabaseOptions } from './database.options.js';
import { CreateExportaciones20261017100000 } from './migrations/20261017100000-CreateExportaciones.js';
import { AllowExportCleanupKeys20261017110000 } from './migrations/20261017110000-AllowExportCleanupKeys.js';
import { ReportesService } from '../reportes/reportes.service.js';
import { ExportacionTipo } from '../exportaciones/enums/exportacion-tipo.enum.js';

const schemaName = `test_export_${randomBytes(8).toString('hex')}`;
const quotedSchema = `"${schemaName}"`;
let admin: DatabaseDataSource | undefined;
let isolated: DatabaseDataSource | undefined;
let created = false;
let step = 'inicialización';

function code(error: unknown): string | undefined {
  return error instanceof QueryFailedError ? (error.driverError as { code?: string }).code : undefined;
}

async function expectCheckFailure(callback: () => Promise<unknown>, expected = '23514'): Promise<void> {
  try { await callback(); } catch (error: unknown) { if (code(error) === expected) return; throw error; }
  throw new Error(`PostgreSQL permitió una operación que debía rechazar (${expected}).`);
}

async function verify(): Promise<void> {
  const base = createDatabaseOptions(loadEnvironment());
  admin = new DatabaseDataSource({ ...base, schema: 'public', entities: [], migrations: [] });
  await admin.initialize();
  if (!/^test_export_[a-f0-9]{16}$/.test(schemaName)) throw new Error('Nombre de esquema temporal inválido.');
  await admin.query(`CREATE SCHEMA ${quotedSchema}`); created = true;
  isolated = new DatabaseDataSource({ ...base, schema: schemaName, entities: [], migrations: base.migrations });
  await isolated.initialize();
  await isolated.runMigrations({ transaction: 'all' });

  const periodId = randomBytes(16).toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  const actorId = randomBytes(16).toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  const requestId = randomBytes(16).toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  await isolated.query(`INSERT INTO ${quotedSchema}."usuario" ("id","email","nombres","apellidos","rol","id_externo_sso") VALUES ($1,'admin@verification.example','Admin','Verificación','ADMIN','verify-admin')`, [actorId]);
  await isolated.query(`INSERT INTO ${quotedSchema}."periodo_titulacion" ("id","codigo","nombre","fecha_inicio_postulacion","fecha_fin_postulacion","fecha_inicio_titulacion","max_integrantes_default") VALUES ($1,'VERIFY','Período verificador',now()-interval '2 days',now()-interval '1 day',now(),4)`, [periodId]);

  step = 'consultas de los siete reportes';
  const reports = new ReportesService(isolated);
  await reports.withSnapshot(async (manager) => {
    for (const type of Object.values(ExportacionTipo)) {
      const output = await reports.generar(manager, periodId, type, {});
      if (!output.columnas.length) throw new Error(`El reporte ${type} no definió encabezados.`);
    }
  });

  step = 'restricciones de filtros y tamaño';
  await expectCheckFailure(() => isolated!.query(`INSERT INTO ${quotedSchema}."solicitud_exportacion" ("periodo_id","solicitante_id","tipo_reporte","formato","filtros") VALUES ($1,$2,'ESTUDIANTES','CSV','[]'::jsonb)`, [periodId, actorId]));
  await expectCheckFailure(() => isolated!.query(`INSERT INTO ${quotedSchema}."solicitud_exportacion" ("periodo_id","solicitante_id","tipo_reporte","formato","tamano_bytes") VALUES ($1,$2,'ESTUDIANTES','CSV',0)`, [periodId, actorId]));
  await expectCheckFailure(() => isolated!.query(`INSERT INTO ${quotedSchema}."solicitud_exportacion" ("periodo_id","solicitante_id","tipo_reporte","formato","estado") VALUES ($1,$2,'ESTUDIANTES','CSV','LISTO')`, [periodId, actorId]));

  step = 'inmutabilidad y solicitudes';
  await isolated.query(`INSERT INTO ${quotedSchema}."solicitud_exportacion" ("id","periodo_id","solicitante_id","tipo_reporte","formato") VALUES ($1,$2,$3,'ESTUDIANTES','CSV')`, [requestId, periodId, actorId]);
  await expectCheckFailure(() => isolated!.query(`UPDATE ${quotedSchema}."solicitud_exportacion" SET "filtros"='{"estado":"HABILITADO"}' WHERE "id"=$1`, [requestId]));

  step = 'reclamo concurrente';
  const claim = () => isolated!.transaction(async (manager) => manager.query(`UPDATE ${quotedSchema}."solicitud_exportacion" SET "estado"='PROCESANDO',"reserva_id"=gen_random_uuid(),"reserva_expira_en"=now()+interval '2 minutes',"intentos"="intentos"+1 WHERE "id"=$1 AND "estado"='EN_COLA' RETURNING "id"`, [requestId]));
  const claims = await Promise.all([claim(), claim()]);
  const totalClaims = claims.reduce((sum, result) => sum + ((result as [unknown[], number])[0]?.length ?? 0), 0);
  if (totalClaims !== 1) throw new Error(`El trabajo se reclamó ${totalClaims} veces, debía reclamarse una.`);

  step = 'reversión de actualización';
  const before = await isolated.query(`SELECT "estado" FROM ${quotedSchema}."solicitud_exportacion" WHERE "id"=$1`, [requestId]) as Array<{ estado: string }>;
  try {
    await isolated.transaction(async (manager) => {
      await manager.query(`UPDATE ${quotedSchema}."solicitud_exportacion" SET "estado"='FALLIDO',"reserva_id"=NULL,"reserva_expira_en"=NULL WHERE "id"=$1`, [requestId]);
      throw new Error('fallo deliberado de auditoría');
    });
  } catch (error: unknown) { if (!(error instanceof Error) || error.message !== 'fallo deliberado de auditoría') throw error; }
  const after = await isolated.query(`SELECT "estado" FROM ${quotedSchema}."solicitud_exportacion" WHERE "id"=$1`, [requestId]) as Array<{ estado: string }>;
  if (before[0]?.estado !== after[0]?.estado) throw new Error('El rollback dejó una actualización parcial.');

  step = 'reversión protegida';
  const cleanupKey = `exportaciones/verificacion/${requestId}.csv`;
  await isolated.query(`INSERT INTO ${quotedSchema}."archivo_limpieza_pendiente" ("ruta_almacenamiento") VALUES ($1)`, [cleanupKey]);
  const cleanupDown = isolated.createQueryRunner(); await cleanupDown.connect(); await cleanupDown.startTransaction();
  try {
    let rejected = false;
    try { await new AllowExportCleanupKeys20261017110000().down(cleanupDown); }
    catch (error: unknown) { rejected = error instanceof Error && error.message.includes('limpiezas de archivos de exportación pendientes'); }
    if (!rejected) throw new Error('La reversión no protegió la limpieza de objetos de exportación pendiente.');
  } finally {
    if (cleanupDown.isTransactionActive) await cleanupDown.rollbackTransaction();
    await cleanupDown.release();
  }
  await isolated.query(`DELETE FROM ${quotedSchema}."archivo_limpieza_pendiente" WHERE "ruta_almacenamiento"=$1`, [cleanupKey]);

  const downRunner = isolated.createQueryRunner(); await downRunner.connect();
  await downRunner.startTransaction();
  try {
    let rejected = false;
    let downMessage = 'la reversión finalizó sin error';
    try { await new CreateExportaciones20261017100000().down(downRunner); }
    catch (error: unknown) { downMessage = error instanceof Error ? error.message : 'error desconocido'; rejected = downMessage.includes('solicitudes históricas'); }
    if (!rejected) throw new Error(`La reversión no protegió las solicitudes históricas: ${downMessage}.`);
  } finally {
    if (downRunner.isTransactionActive) await downRunner.rollbackTransaction();
    await downRunner.release();
  }
}

try {
  await verify();
  process.stdout.write('db:verify-exportaciones completado.\n');
} catch (error: unknown) {
  process.stderr.write(`Falló db:verify-exportaciones durante ${step}: ${error instanceof Error ? error.message : 'error no identificado'}.\n`);
  process.exitCode = 1;
} finally {
  await isolated?.destroy().catch(() => undefined);
  if (created) await admin?.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`).catch(() => undefined);
  await admin?.destroy().catch(() => undefined);
}
