import { randomBytes } from 'node:crypto';
import { ConflictException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { Auditoria } from '../auditoria/entities/auditoria.entity.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { EstudianteHabilitado } from '../habilitados/entities/estudiante-habilitado.entity.js';
import { LoteImportacion } from '../importaciones/entities/lote-importacion.entity.js';
import { LineaInvestigacion } from '../lineas-investigacion/entities/linea-investigacion.entity.js';
import { LineasInvestigacionService } from '../lineas-investigacion/lineas-investigacion.service.js';
import { CreateLineaInvestigacionDto } from '../lineas-investigacion/dto/create-linea-investigacion.dto.js';
import { UpdateLineaInvestigacionDto } from '../lineas-investigacion/dto/update-linea-investigacion.dto.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { loadEnvironment } from '../config/load-environment.js';
import { createDatabaseOptions } from './database.options.js';
import { DatabaseDataSource } from './database-data-source.js';
import { CreateUsuario20261002000000 } from './migrations/20261002000000-CreateUsuario.js';
import { CreateEstudianteDocente20261002010000 } from './migrations/20261002010000-CreateEstudianteDocente.js';
import { CreatePeriodoTitulacion20261002020000 } from './migrations/20261002020000-CreatePeriodoTitulacion.js';
import { CreateHabilitados20261002030000 } from './migrations/20261002030000-CreateHabilitados.js';
import { CreateLineaInvestigacion20261002040000 } from './migrations/20261002040000-CreateLineaInvestigacion.js';

const schema = `test_lineas_${randomBytes(8).toString('hex')}`;
let schemaCreated = false;
let step = 'conexión y migraciones';
let admin: DatabaseDataSource | undefined;
let isolated: DatabaseDataSource | undefined;

function schemaIdentifier(): string {
  if (!/^test_lineas_[a-f0-9]{16}$/.test(schema)) throw new Error('El esquema temporal no es válido.');
  return `"${schema}"`;
}

function driverCode(error: unknown): string | undefined {
  return error instanceof QueryFailedError ? (error.driverError as { code?: string }).code : undefined;
}

async function checkRejectedCheck(sql: string, params: unknown[]): Promise<boolean> {
  try { await isolated!.query(sql, params); return false; }
  catch (error: unknown) { return driverCode(error) === '23514'; }
}

async function verify(): Promise<void> {
  const options = createDatabaseOptions(loadEnvironment());
  admin = new DatabaseDataSource({ ...options, schema: 'public', entities: [], migrations: [] });
  await admin.initialize();
  await admin.query(`CREATE SCHEMA ${schemaIdentifier()}`);
  schemaCreated = true;
  isolated = new DatabaseDataSource({
    ...options, schema,
    entities: [Usuario, Estudiante, Docente, PeriodoTitulacion, EstudianteHabilitado, LoteImportacion, Auditoria, LineaInvestigacion],
    migrations: [CreateUsuario20261002000000, CreateEstudianteDocente20261002010000, CreatePeriodoTitulacion20261002020000, CreateHabilitados20261002030000, CreateLineaInvestigacion20261002040000],
  });
  await isolated.initialize();
  await isolated.runMigrations({ transaction: 'all' });

  step = 'crear actor ADMIN';
  const users = isolated.getRepository(Usuario);
  const actor = await users.save(users.create({
    email: 'admin@verification.example', nombres: 'Admin', apellidos: 'Verificación',
    rol: UsuarioRol.ADMIN, estado: UsuarioEstado.ACTIVO, id_externo_sso: 'verify-admin',
    ultimo_acceso: null,
  }));
  const service = new LineasInvestigacionService(isolated.getRepository(LineaInvestigacion), isolated, new AuditoriaService());

  step = 'alta y auditoría';
  const created = await service.create({ codigo: 'IA', nombre: 'Inteligencia artificial', descripcion: '  Sistemas inteligentes  ' } as CreateLineaInvestigacionDto, actor, null);
  if (created.descripcion !== 'Sistemas inteligentes' || !created.activa) throw new Error('La normalización o estado inicial no es correcto.');
  const beforeNoOp = await isolated.getRepository(Auditoria).count();
  await service.update(created.id, { nombre: 'Inteligencia artificial' } as UpdateLineaInvestigacionDto, actor, null);
  if (await isolated.getRepository(Auditoria).count() !== beforeNoOp) throw new Error('La edición sin cambios añadió auditoría.');
  step = 'código exacto y nombres repetibles';
  const caseVariant = await service.create({ codigo: 'ia', nombre: 'Inteligencia artificial' } as CreateLineaInvestigacionDto, actor, null);
  if (caseVariant.codigo !== 'ia' || caseVariant.nombre !== created.nombre) throw new Error('La unicidad no preservó la comparación exacta o bloqueó nombres repetidos.');
  const beforePatchAudit = await isolated.getRepository(Auditoria).count();
  const changed = await service.update(created.id, { descripcion: null, activa: false } as UpdateLineaInvestigacionDto, actor, '127.0.0.1');
  if (changed.descripcion !== null || changed.activa || await isolated.getRepository(Auditoria).count() !== beforePatchAudit + 1) throw new Error('La edición no guardó campos y auditoría juntos.');

  step = 'unicidad concurrente';
  const creates = await Promise.allSettled([
    service.create({ codigo: 'CONCURRENCY', nombre: 'Primera' } as CreateLineaInvestigacionDto, actor, null),
    service.create({ codigo: 'CONCURRENCY', nombre: 'Segunda' } as CreateLineaInvestigacionDto, actor, null),
  ]);
  const successful = creates.filter((result) => result.status === 'fulfilled').length;
  const conflicts = creates.filter((result) => result.status === 'rejected' && result.reason instanceof ConflictException).length;
  if (successful !== 1 || conflicts !== 1) throw new Error('La unicidad no protegió altas concurrentes.');

  step = 'restricciones CHECK';
  const table = `${schemaIdentifier()}."linea_investigacion"`;
  for (const [column, value] of [['codigo', ' '], ['nombre', ' '], ['descripcion', ' ']] as const) {
    const rejected = await checkRejectedCheck(`INSERT INTO ${table} ("codigo", "nombre", "descripcion") VALUES ($1, $2, $3)`, [column === 'codigo' ? value : `CHECK-${column}`, column === 'nombre' ? value : 'Nombre', column === 'descripcion' ? value : null]);
    if (!rejected) throw new Error(`PostgreSQL aceptó texto vacío en ${column}.`);
  }

  step = 'atomicidad de auditoría';
  const auditTable = `${schemaIdentifier()}."auditoria"`;
  const functionName = `${schemaIdentifier()}."rechazar_auditoria_lineas"`;
  await isolated.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo de auditoría'; END; $$`);
  await isolated.query(`CREATE TRIGGER "TRG_verify_lineas_audit_failure" BEFORE INSERT ON ${auditTable} FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
  let failureControlled = false;
  try { await service.create({ codigo: 'ROLLBACK', nombre: 'No persistir' } as CreateLineaInvestigacionDto, actor, null); }
  catch (error: unknown) { failureControlled = error instanceof ServiceUnavailableException; }
  await isolated.query(`DROP TRIGGER "TRG_verify_lineas_audit_failure" ON ${auditTable}`);
  await isolated.query(`DROP FUNCTION ${functionName}()`);
  const afterFailure = await isolated.getRepository(LineaInvestigacion).findOneBy({ codigo: 'ROLLBACK' });
  if (!failureControlled || afterFailure) throw new Error('La línea persistió sin su auditoría correspondiente.');

  step = 'protección de reversión';
  let protectedDown = false;
  try { await isolated.undoLastMigration(); }
  catch (error: unknown) { protectedDown = error instanceof Error && error.message.includes('tabla linea_investigacion contiene registros'); }
  if (!protectedDown || !(await isolated.getRepository(LineaInvestigacion).count())) throw new Error('La reversión no protegió las líneas registradas.');
}

async function cleanup(): Promise<void> {
  let failed = false;
  if (isolated?.isInitialized) { try { await isolated.destroy(); } catch { failed = true; } }
  if (schemaCreated && admin?.isInitialized) { try { await admin.query(`DROP SCHEMA ${schemaIdentifier()} CASCADE`); } catch { failed = true; } }
  if (admin?.isInitialized) { try { await admin.destroy(); } catch { failed = true; } }
  if (failed) throw new Error('No se pudo limpiar el esquema temporal de verificación.');
}

let verified = false;
try { await verify(); verified = true; }
catch (error: unknown) {
  const cause = error instanceof HttpException ? error.cause : error;
  const detail = cause instanceof QueryFailedError ? `error PostgreSQL ${driverCode(cause) ?? 'desconocido'}` : error instanceof Error ? error.message : 'error desconocido';
  console.error(`Falló la verificación aislada durante ${step}: ${detail}. No se modificó el esquema configurado.`);
  process.exitCode = 1;
} finally { try { await cleanup(); } catch { console.error('No se pudo limpiar el esquema temporal de verificación.'); process.exitCode = 1; } }

if (verified && process.exitCode !== 1) console.info('Migración, restricciones, concurrencia, auditoría atómica y reversión de líneas verificadas en esquema temporal.');
