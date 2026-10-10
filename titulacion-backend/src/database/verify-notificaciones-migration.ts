import { randomBytes, randomUUID } from 'node:crypto';
import { QueryFailedError } from 'typeorm';
import { loadEnvironment } from '../config/load-environment.js';
import { createDatabaseOptions } from './database.options.js';
import { DatabaseDataSource } from './database-data-source.js';
import { CreateNotificaciones20261013100000 } from './migrations/20261013100000-CreateNotificaciones.js';
import { EnforceNotificationEmailDelivery20261014100000 } from './migrations/20261014100000-EnforceNotificationEmailDelivery.js';
import { ExtendProcessNotifications20261015100000 } from './migrations/20261015100000-ExtendProcessNotifications.js';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment.js';
import { CorreoWorker } from '../correo/correo.worker.js';
import { SmtpTransportService } from '../correo/smtp-transport.service.js';

const schema = `test_notificaciones_${randomBytes(8).toString('hex')}`;
const quoted = () => { if (!/^test_notificaciones_[a-f0-9]{16}$/.test(schema)) throw new Error('Esquema temporal inválido.'); return `"${schema}"`; };
let admin: DatabaseDataSource | undefined;
let isolated: DatabaseDataSource | undefined;
let created = false;
const code = (error: unknown) => error instanceof QueryFailedError ? (error.driverError as { code?: string }).code : error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;

async function verify(): Promise<void> {
  const options = createDatabaseOptions(loadEnvironment());
  admin = new DatabaseDataSource({ ...options, schema: 'public', entities: [], migrations: [] });
  await admin.initialize();
  await admin.query(`CREATE SCHEMA ${quoted()}`); created = true;
  isolated = new DatabaseDataSource({ ...options, schema, entities: [], migrations: [] });
  await isolated.initialize();
  await isolated.query(`CREATE TABLE ${quoted()}."usuario" ("id" uuid PRIMARY KEY, "email" text NOT NULL, "estado" varchar(20) NOT NULL DEFAULT 'ACTIVO')`);
  const userId = randomUUID();
  await isolated.query(`INSERT INTO ${quoted()}."usuario" ("id","email") VALUES ($1,'notificaciones@example.test')`, [userId]);
  const migration = new CreateNotificaciones20261013100000();
  const runner = isolated.createQueryRunner(); await runner.connect(); await runner.startTransaction();
  try { await migration.up(runner); await runner.commitTransaction(); }
  catch (error: unknown) { if (runner.isTransactionActive) await runner.rollbackTransaction(); throw error; }
  finally { await runner.release(); }
  const integrityMigration = new EnforceNotificationEmailDelivery20261014100000();
  const integrityRunner = isolated.createQueryRunner(); await integrityRunner.connect(); await integrityRunner.startTransaction();
  try { await integrityMigration.up(integrityRunner); await integrityRunner.commitTransaction(); }
  catch (error: unknown) { if (integrityRunner.isTransactionActive) await integrityRunner.rollbackTransaction(); throw error; }
  finally { await integrityRunner.release(); }
  const processMigration = new ExtendProcessNotifications20261015100000();
  const processRunner = isolated.createQueryRunner(); await processRunner.connect(); await processRunner.startTransaction();
  try { await processMigration.up(processRunner); await processRunner.commitTransaction(); }
  catch (error: unknown) { if (processRunner.isTransactionActive) await processRunner.rollbackTransaction(); throw error; }
  finally { await processRunner.release(); }

  const appId = randomUUID(); const emailId = randomUUID();
  await isolated.query(`INSERT INTO ${quoted()}."notificacion" ("id","usuario_id","tipo","titulo","mensaje","entidad_tipo","entidad_id","canal","fecha_envio") VALUES ($1,$2,'PAT_ENTREGADO','Nueva entrega','Aviso de prueba','documento_pat',$3,'EN_APP',CURRENT_TIMESTAMP)`, [appId, userId, randomUUID()]);
  const duplicate = await isolated.query(`INSERT INTO ${quoted()}."notificacion" ("usuario_id","tipo","titulo","mensaje","entidad_tipo","entidad_id","canal","fecha_envio") SELECT "usuario_id","tipo","titulo","mensaje","entidad_tipo","entidad_id","canal","fecha_envio" FROM ${quoted()}."notificacion" WHERE "id"=$1`, [appId]).then(() => ({ blocked: false, detail: 'insert accepted' }), (error: unknown) => ({ blocked: code(error) === '23505', detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }));
  if (!duplicate.blocked) throw new Error(`La base no impidió avisos duplicados por destinatario y canal (${duplicate.detail}).`);
  const concurrentEntityId = randomUUID();
  const concurrent = await Promise.all([
    isolated.query(`INSERT INTO ${quoted()}."notificacion" ("usuario_id","tipo","titulo","mensaje","entidad_tipo","entidad_id","canal","fecha_envio") VALUES ($1,$2,'Aviso','Prueba concurrente',$3,$4,'EN_APP',CURRENT_TIMESTAMP)`, [userId, 'PAT_ENTREGADO', 'documento_pat', concurrentEntityId]).then(() => true, () => false),
    isolated.query(`INSERT INTO ${quoted()}."notificacion" ("usuario_id","tipo","titulo","mensaje","entidad_tipo","entidad_id","canal","fecha_envio") VALUES ($1,$2,'Aviso','Prueba concurrente',$3,$4,'EN_APP',CURRENT_TIMESTAMP)`, [userId, 'PAT_ENTREGADO', 'documento_pat', concurrentEntityId]).then(() => true, () => false),
  ]);
  if (concurrent.filter(Boolean).length !== 1) throw new Error('La restricción única no protegió notificaciones concurrentes.');
  const failedDelivery = randomUUID();
  const rollback = isolated.createQueryRunner(); await rollback.connect(); await rollback.startTransaction();
  try {
    await rollback.query(`INSERT INTO ${quoted()}."notificacion" ("id","usuario_id","tipo","titulo","mensaje","entidad_tipo","entidad_id","canal") VALUES ($1,$2,'PAT_REVISADO','Revisión','Rollback','revision_pat',$3,'EMAIL')`, [failedDelivery, userId, randomUUID()]);
    await rollback.query(`INSERT INTO ${quoted()}."entrega_correo_notificacion" ("notificacion_id","estado") VALUES ($1,'PENDIENTE')`, [failedDelivery]);
    await rollback.rollbackTransaction();
  } catch (error: unknown) { if (rollback.isTransactionActive) await rollback.rollbackTransaction(); throw error; }
  finally { await rollback.release(); }
  const rolledBack = await isolated.query(`SELECT 1 FROM ${quoted()}."notificacion" WHERE "id"=$1`, [failedDelivery]) as unknown[];
  if (rolledBack.length) throw new Error('Una solicitud fallida dejó una notificación confirmada parcialmente.');
  await isolated.query(`UPDATE ${quoted()}."notificacion" SET "leida"=true WHERE "id"=$1`, [appId]);
  const immutable = await isolated.query(`UPDATE ${quoted()}."notificacion" SET "mensaje"='alterado' WHERE "id"=$1`, [appId]).then(() => false, (error: unknown) => code(error) === '23514');
  const deleteBlocked = await isolated.query(`DELETE FROM ${quoted()}."notificacion" WHERE "id"=$1`, [appId]).then(() => false, (error: unknown) => code(error) === '23514');
  if (!immutable || !deleteBlocked) throw new Error('La base permitió alterar o eliminar una notificación histórica.');
  await isolated.query(`INSERT INTO ${quoted()}."notificacion" ("id","usuario_id","tipo","titulo","mensaje","entidad_tipo","entidad_id","canal") VALUES ($1,$2,'PAT_REVISADO','PAT revisado','Resultado de prueba','revision_pat',$3,'EMAIL')`, [emailId, userId, randomUUID()]);
  const deliveryId = randomUUID();
  await isolated.query(`INSERT INTO ${quoted()}."entrega_correo_notificacion" ("id","notificacion_id") VALUES ($1,$2)`, [deliveryId, emailId]);
  const appChannelRejected = await isolated.query(`INSERT INTO ${quoted()}."entrega_correo_notificacion" ("notificacion_id") VALUES ($1)`, [appId]).then(() => false, (error: unknown) => code(error) === '23514');
  if (!appChannelRejected) throw new Error('La base permitió crear una entrega de correo para un aviso solo de aplicación.');
  const invalidLease = await isolated.query(`UPDATE ${quoted()}."entrega_correo_notificacion" SET "estado"='PROCESANDO' WHERE "id"=$1`, [deliveryId]).then(() => false, (error: unknown) => code(error) === '23514');
  if (!invalidLease) throw new Error('La base permitió estado PROCESANDO sin reserva.');
  const claims = await Promise.all([
    isolated.query(`UPDATE ${quoted()}."entrega_correo_notificacion" SET "estado"='PROCESANDO', "reserva_hasta"=CURRENT_TIMESTAMP + INTERVAL '2 minutes', "reserva_token"=$2 WHERE "id"=$1 AND "generacion_reintento"=0 AND "estado"='PENDIENTE' RETURNING "id"`, [deliveryId, randomUUID()]),
    isolated.query(`UPDATE ${quoted()}."entrega_correo_notificacion" SET "estado"='PROCESANDO', "reserva_hasta"=CURRENT_TIMESTAMP + INTERVAL '2 minutes', "reserva_token"=$2 WHERE "id"=$1 AND "generacion_reintento"=0 AND "estado"='PENDIENTE' RETURNING "id"`, [deliveryId, randomUUID()]),
  ]);
  const claimedCounts = claims.map((result) => Array.isArray(result) && Array.isArray(result[0]) ? result[0].length : Array.isArray(result) ? result.length : 0);
  if (claimedCounts.reduce((total, count) => total + count, 0) !== 1) {
    const state = await isolated.query(`SELECT "estado"::text AS estado, "intentos" FROM ${quoted()}."entrega_correo_notificacion" WHERE "id"=$1`, [deliveryId]) as Array<{ estado: string; intentos: number }>;
    throw new Error(`Dos workers reclamaron simultáneamente la misma entrega de correo (filas=${claimedCounts.join(',')}; estado=${state[0]?.estado}; intentos=${state[0]?.intentos}).`);
  }
  await isolated.query(`UPDATE ${quoted()}."entrega_correo_notificacion" SET "reserva_hasta"=CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE "id"=$1`, [deliveryId]);
  const reclaimedResult: unknown = await isolated.query(`UPDATE ${quoted()}."entrega_correo_notificacion" SET "estado"='PENDIENTE', "generacion_reintento"="generacion_reintento"+1, "reserva_hasta"=NULL, "reserva_token"=NULL WHERE "id"=$1 AND "estado"='PROCESANDO' AND "reserva_hasta" <= CURRENT_TIMESTAMP RETURNING "id", "generacion_reintento"`, [deliveryId]);
  const reclaimed = Array.isArray(reclaimedResult) && Array.isArray(reclaimedResult[0]) ? reclaimedResult[0] : reclaimedResult;
  if (!Array.isArray(reclaimed) || reclaimed.length === 0) throw new Error('No se recuperó una reserva de correo vencida.');
  const generation = Number((reclaimed[0] as { generacion_reintento: number }).generacion_reintento);
  const environment = loadEnvironment();
  if (['127.0.0.1', 'localhost', '[::1]'].includes(environment.SMTP_HOST ?? '') && environment.SMTP_PORT === 1025) {
    const config = new ConfigService<AppEnvironment, true>(environment);
    const worker = new CorreoWorker(isolated, config, new SmtpTransportService(config));
    await worker.process({ name: 'enviar-notificacion', data: { id: deliveryId, generation } } as never);
    const sent = await isolated.query(`SELECT e."estado"::text AS estado, n."fecha_envio" FROM ${quoted()}."entrega_correo_notificacion" e JOIN ${quoted()}."notificacion" n ON n."id"=e."notificacion_id" WHERE e."id"=$1`, [deliveryId]) as Array<{ estado: string; fecha_envio: Date | null }>;
    if (sent[0]?.estado !== 'ENVIADO' || !sent[0]?.fecha_envio) throw new Error('El worker no confirmó el correo aceptado por Mailpit.');
    const mailpit = await fetch('http://127.0.0.1:8025/api/v1/messages?limit=50').then((response) => response.ok ? response.json() as Promise<{ messages?: unknown[] }> : null).catch(() => null);
    const received = (mailpit?.messages ?? []).some((message) => JSON.stringify(message).includes('notificaciones@example.test') && JSON.stringify(message).includes('PAT revisado'));
    if (!received) throw new Error('Mailpit no mostró el mensaje de prueba de notificaciones.');
  }
  const runnerDown = isolated.createQueryRunner(); await runnerDown.connect(); await runnerDown.startTransaction();
  const protectedDown = await processMigration.down(runnerDown).then(async () => integrityMigration.down(runnerDown)).then(async () => migration.down(runnerDown)).then(() => false, async (error: unknown) => { await runnerDown.rollbackTransaction(); return error instanceof Error && error.message.includes('notificaciones'); });
  if (runnerDown.isTransactionActive) await runnerDown.rollbackTransaction(); await runnerDown.release();
  if (!protectedDown) throw new Error('La reversión permitió eliminar registros de notificación.');
  console.log('Verificación correcta: notificaciones únicas e inmutables, canal de aplicación, estado de entrega y reversión protegida.');
}

try { await verify(); }
catch (error: unknown) { console.error(`Falló db:verify-notificaciones: ${error instanceof Error ? error.message : 'error no especificado'}`); process.exitCode = 1; }
finally { if (isolated?.isInitialized) await isolated.destroy().catch(() => undefined); if (admin?.isInitialized && created) await admin.query(`DROP SCHEMA IF EXISTS ${quoted()} CASCADE`).catch(() => undefined); if (admin?.isInitialized) await admin.destroy().catch(() => undefined); }
