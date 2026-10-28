import { randomBytes } from 'node:crypto';
import { QueryFailedError } from 'typeorm';
import { DatabaseDataSource } from './database-data-source.js';
import { createDatabaseOptions } from './database.options.js';
import { loadEnvironment } from '../config/load-environment.js';
import { AuditoriaConsultaService } from '../auditoria/auditoria-consulta.service.js';
import type { ListAuditoriaQueryDto } from '../auditoria/dto/list-auditoria-query.dto.js';

const schema = `test_audit_${randomBytes(8).toString('hex')}`;
const schemaSql = (): string => {
  if (!/^test_audit_[a-f0-9]{16}$/.test(schema)) throw new Error('El esquema temporal no es válido.');
  return `"${schema}"`;
};
let admin: DatabaseDataSource | undefined;
let isolated: DatabaseDataSource | undefined;
let created = false;
let step = 'conexión y migraciones';

const code = (error: unknown) => error instanceof QueryFailedError ? (error.driverError as { code?: string }).code : undefined;
const page = (values: Partial<ListAuditoriaQueryDto>): ListAuditoriaQueryDto => ({ page: 1, limit: 20, ...values }) as ListAuditoriaQueryDto;

async function indexes(db: DatabaseDataSource): Promise<string[]> {
  const rows = await db.query(`SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'auditoria' ORDER BY indexname`, [schema]) as Array<{ indexname: string }>;
  return rows.map((row) => row.indexname);
}

async function verify(): Promise<void> {
  const options = createDatabaseOptions(loadEnvironment());
  admin = new DatabaseDataSource({ ...options, schema: 'public', entities: [], migrations: [] });
  await admin.initialize();
  await admin.query(`CREATE SCHEMA ${schemaSql()}`);
  created = true;
  isolated = new DatabaseDataSource({ ...options, schema, entities: [] });
  await isolated.initialize();
  await isolated.runMigrations({ transaction: 'all' });
  const db = isolated;
  const s = schemaSql();

  step = 'índices creados';
  const present = await indexes(db);
  if (!present.includes('IDX_auditoria_fecha_hora') || !present.includes('IDX_auditoria_usuario')) throw new Error('No se crearon los índices de consulta de auditoría.');

  step = 'consulta con filtros';
  const adminId = '00000000-0000-4000-8000-000000000001';
  const otherId = '00000000-0000-4000-8000-000000000002';
  const entity = '00000000-0000-4000-8000-0000000000aa';
  await db.query(`INSERT INTO ${s}."usuario" ("id","email","nombres","apellidos","rol","estado","id_externo_sso") VALUES ($1,'admin_x@uleam.edu.ec','Ada','Admin','ADMIN','ACTIVO',NULL),($2,'adminxx@uleam.edu.ec','Otro','Admin','ADMIN','ACTIVO',NULL)`, [adminId, otherId]);
  await db.query(`INSERT INTO ${s}."auditoria" ("usuario_id","accion","entidad_tipo","entidad_id","valores_anteriores","valores_nuevos","ip_origen","fecha_hora") VALUES
    ($1,'CREAR_TEMA','tema',$3,NULL,'{"titulo":"A"}','10.0.0.5','2026-10-01T10:00:00Z'),
    ($1,'EDITAR_TEMA','tema',$3,'{"titulo":"A"}','{"titulo":"B"}',NULL,'2026-10-02T10:00:00Z'),
    ($2,'CREAR_USUARIO','usuario',$3,NULL,'{"email":"x"}','10.0.0.6','2026-10-03T10:00:00Z')`, [adminId, otherId, entity]);
  const service = new AuditoriaConsultaService(db);
  const all = await service.listar(page({}));
  if (all.total !== 3 || all.data[0].accion !== 'CREAR_USUARIO' || typeof all.data[0].id !== 'string' || all.data[2].ip_origen !== '10.0.0.5') throw new Error('La consulta sin filtros no respetó orden, id textual o IP.');
  const literal = await service.listar(page({ q: 'admin_x' }));
  if (literal.total !== 2 || literal.data.some((row) => row.actor.id !== adminId)) throw new Error('El texto libre no escapó el comodín _.');
  const range = await service.listar(page({ desde: '2026-10-02', hasta: '2026-10-02', entidad_tipo: 'tema' }));
  if (range.total !== 1 || range.data[0].accion !== 'EDITAR_TEMA') throw new Error('El rango de fechas inclusivo no filtró correctamente.');
  const byActor = await service.listar(page({ usuario_id: otherId, accion: 'CREAR_USUARIO', entidad_id: entity, limit: 1 }));
  if (byActor.total !== 1 || byActor.data[0].actor.email !== 'adminxx@uleam.edu.ec') throw new Error('Los filtros exactos no funcionaron.');

  step = 'reversión';
  await db.undoLastMigration({ transaction: 'all' });
  const after = await indexes(db);
  if (after.includes('IDX_auditoria_fecha_hora') || after.includes('IDX_auditoria_usuario') || !after.includes('IDX_auditoria_entidad')) throw new Error('La reversión no eliminó solo los índices nuevos.');
}

async function cleanup(): Promise<void> {
  let failed = false;
  if (isolated?.isInitialized) { try { await isolated.destroy(); } catch { failed = true; } }
  if (created && admin?.isInitialized) { try { await admin.query(`DROP SCHEMA ${schemaSql()} CASCADE`); } catch { failed = true; } }
  if (admin?.isInitialized) { try { await admin.destroy(); } catch { failed = true; } }
  if (failed) throw new Error('No se pudo eliminar el esquema temporal.');
}

let verified = false;
try { await verify(); verified = true; }
catch (error: unknown) {
  const detail = error instanceof QueryFailedError ? `PostgreSQL ${code(error) ?? 'desconocido'}` : error instanceof Error ? error.message : 'error desconocido';
  console.error(`Falló la verificación de auditoría en ${step}: ${detail}. No se modificó el esquema configurado.`);
  process.exitCode = 1;
} finally { try { await cleanup(); } catch { console.error('No se pudo limpiar el esquema temporal de auditoría.'); process.exitCode = 1; } }

if (verified && process.exitCode !== 1) console.info('Índices y consulta de auditoría (filtros, orden, rango inclusivo, escape ILIKE y reversión) verificados en esquema temporal.');
