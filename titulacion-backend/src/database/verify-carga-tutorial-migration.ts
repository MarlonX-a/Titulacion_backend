import { randomBytes } from 'node:crypto';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { Auditoria } from '../auditoria/entities/auditoria.entity.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CargaTutorialService } from '../carga-tutorial/carga-tutorial.service.js';
import { CargaTutorialPersistenciaService } from '../carga-tutorial/carga-tutorial-persistencia.service.js';
import { ConfigCargaTutorial } from '../carga-tutorial/entities/config-carga-tutorial.entity.js';
import { CreateUsuario20261002000000 } from './migrations/20261002000000-CreateUsuario.js';
import { CreateEstudianteDocente20261002010000 } from './migrations/20261002010000-CreateEstudianteDocente.js';
import { CreatePeriodoTitulacion20261002020000 } from './migrations/20261002020000-CreatePeriodoTitulacion.js';
import { CreateHabilitados20261002030000 } from './migrations/20261002030000-CreateHabilitados.js';
import { CreateCargaTutorial20261007100000 } from './migrations/20261007100000-CreateCargaTutorial.js';
import { loadEnvironment } from '../config/load-environment.js';
import { createDatabaseOptions } from './database.options.js';
import { DatabaseDataSource } from './database-data-source.js';

const schema = `test_carga_${randomBytes(8).toString('hex')}`;
let schemaCreated = false;
let admin: DatabaseDataSource | undefined;
let isolated: DatabaseDataSource | undefined;
let step = 'conexión';

function quotedSchema(): string {
  if (!/^test_carga_[a-f0-9]{16}$/.test(schema)) throw new Error('Esquema temporal inválido.');
  return `"${schema}"`;
}

function code(error: unknown): string | undefined {
  return error instanceof QueryFailedError ? (error.driverError as { code?: string }).code : undefined;
}

async function verify(): Promise<void> {
  const options = createDatabaseOptions(loadEnvironment());
  admin = new DatabaseDataSource({ ...options, schema: 'public', entities: [], migrations: [] });
  await admin.initialize();
  await admin.query(`CREATE SCHEMA ${quotedSchema()}`);
  schemaCreated = true;
  isolated = new DatabaseDataSource({
    ...options,
    schema,
    entities: [Usuario, Docente, PeriodoTitulacion, ConfigCargaTutorial, Auditoria],
    migrations: [CreateUsuario20261002000000, CreateEstudianteDocente20261002010000, CreatePeriodoTitulacion20261002020000, CreateHabilitados20261002030000, CreateCargaTutorial20261007100000],
  });
  await isolated.initialize();
  await isolated.runMigrations({ transaction: 'all' });

  step = 'crear fixtures';
  const users = isolated.getRepository(Usuario);
  const actor = await users.save(users.create({
    email: 'admin@verification.example', nombres: 'Admin', apellidos: 'Verificación',
    rol: UsuarioRol.ADMIN, estado: UsuarioEstado.ACTIVO, id_externo_sso: 'verify-admin', ultimo_acceso: null,
  }));
  const teacherUser = await users.save(users.create({
    email: 'docente@verification.example', nombres: 'Docente', apellidos: 'Verificación',
    rol: UsuarioRol.DOCENTE, estado: UsuarioEstado.ACTIVO, id_externo_sso: 'verify-docente', ultimo_acceso: null,
  }));
  const teacher = await isolated.getRepository(Docente).save(isolated.getRepository(Docente).create({
    usuario: teacherUser, cedula: '0102030405', titulo_academico: 'Magíster', departamento: 'Sistemas', habilitado_tutoria: false,
  }));
  const periodRepo = isolated.getRepository(PeriodoTitulacion);
  const period = await periodRepo.save(periodRepo.create({
    codigo: 'VERIFY', nombre: 'Verificación', fecha_inicio_postulacion: new Date('2026-01-01T00:00:00Z'),
    fecha_fin_postulacion: new Date('2026-02-01T00:00:00Z'), fecha_inicio_titulacion: new Date('2026-02-01T00:00:00Z'),
    estado: PeriodoEstado.BORRADOR, max_integrantes_default: 4,
  }));
  const secondPeriod = await periodRepo.save(periodRepo.create({
    codigo: 'VERIFY-2', nombre: 'Verificación dos', fecha_inicio_postulacion: new Date('2026-01-01T00:00:00Z'),
    fecha_fin_postulacion: new Date('2026-02-01T00:00:00Z'), fecha_inicio_titulacion: new Date('2026-02-01T00:00:00Z'),
    estado: PeriodoEstado.BORRADOR, max_integrantes_default: 4,
  }));
  const service = new CargaTutorialService(
    isolated.getRepository(ConfigCargaTutorial), periodRepo, isolated.getRepository(Docente), isolated,
    new AuditoriaService(), new CargaTutorialPersistenciaService(),
  );

  step = 'configuración y prioridad efectiva';
  const global = await service.create(period.id, { max_trabajos: 5, bloquear_al_superar: true }, actor, null);
  const specific = await service.create(period.id, { docente_id: teacher.id, max_trabajos: 2, bloquear_al_superar: false }, actor, null);
  const effective = await service.effectiveForDocente(period.id, teacher.id);
  if (effective.origen !== 'DOCENTE' || effective.configuracion?.id !== specific.id || effective.configuracion.bloquear_al_superar) {
    throw new Error('La configuración específica no prevalece en todos sus campos.');
  }
  const noConfig = await service.effectiveForDocente(secondPeriod.id, teacher.id);
  if (noConfig.origen !== 'SIN_CONFIGURACION' || noConfig.configuracion !== null) throw new Error('Se inventó una configuración efectiva inexistente.');
  const list = await service.list(period.id, { page: 1, limit: 20 });
  if (list.data[0]?.id !== global.id) throw new Error('El listado no coloca primero el límite global.');

  step = 'restricciones y claves foráneas';
  const table = `${quotedSchema()}."config_carga_tutorial"`;
  let checkRejected = false;
  try { await isolated.query(`INSERT INTO ${table} ("periodo_id", "max_trabajos", "bloquear_al_superar") VALUES ($1, 0, true)`, [period.id]); }
  catch (error: unknown) { checkRejected = code(error) === '23514'; }
  if (!checkRejected) throw new Error('PostgreSQL aceptó max_trabajos menor que uno.');
  let fkRejected = false;
  try { await isolated.query(`INSERT INTO ${table} ("periodo_id", "max_trabajos", "bloquear_al_superar") VALUES ($1, 1, true)`, ['00000000-0000-4000-8000-000000000001']); }
  catch (error: unknown) { fkRejected = code(error) === '23503'; }
  if (!fkRejected) throw new Error('PostgreSQL aceptó una referencia a período inexistente.');

  step = 'unicidad concurrente del ámbito global';
  const race = await Promise.allSettled([
    service.create(secondPeriod.id, { max_trabajos: 3, bloquear_al_superar: true }, actor, null),
    service.create(secondPeriod.id, { max_trabajos: 4, bloquear_al_superar: false }, actor, null),
  ]);
  const successes = race.filter((item) => item.status === 'fulfilled').length;
  const conflicts = race.filter((item) => item.status === 'rejected' && item.reason instanceof ConflictException).length;
  if (successes !== 1 || conflicts !== 1) throw new Error('UNIQUE NULLS NOT DISTINCT no detuvo configuraciones globales concurrentes.');

  step = 'atomicidad de auditoría';
  const fn = `${quotedSchema()}."rechazar_auditoria_carga"`;
  await isolated.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo auditoría'; END; $$`);
  await isolated.query(`CREATE TRIGGER "TRG_verify_carga_audit_failure" BEFORE INSERT ON ${quotedSchema()}."auditoria" FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
  let auditFailed = false;
  try { await service.create(secondPeriod.id, { docente_id: teacher.id, max_trabajos: 8, bloquear_al_superar: true }, actor, null); }
  catch (error: unknown) { auditFailed = error instanceof ServiceUnavailableException; }
  await isolated.query(`DROP TRIGGER "TRG_verify_carga_audit_failure" ON ${quotedSchema()}."auditoria"`);
  await isolated.query(`DROP FUNCTION ${fn}()`);
  const rolledBack = await isolated.getRepository(ConfigCargaTutorial).findOneBy({ periodo_id: secondPeriod.id, docente_id: teacher.id });
  if (!auditFailed || rolledBack) throw new Error('La configuración persistió aunque su auditoría falló.');

  step = 'reversión protegida con registros';
  let protectedDown = false;
  try { await isolated.undoLastMigration(); }
  catch (error: unknown) { protectedDown = error instanceof Error && error.message.includes('config_carga_tutorial contiene registros'); }
  if (!protectedDown) throw new Error('La reversión no protegió las configuraciones existentes.');

  step = 'reversión segura en tabla vacía';
  await isolated.getRepository(Auditoria).delete({ entidad_tipo: 'config_carga_tutorial' });
  await isolated.getRepository(ConfigCargaTutorial).clear();
  await isolated.undoLastMigration();
  const remaining = await isolated.query(`SELECT to_regclass($1) AS table_name`, [`${schema}.config_carga_tutorial`]) as Array<{ table_name: string | null }>;
  if (remaining[0]?.table_name !== null) throw new Error('La reversión de una tabla vacía no la eliminó.');
}

async function cleanup(): Promise<void> {
  let failed = false;
  if (isolated?.isInitialized) { try { await isolated.destroy(); } catch { failed = true; } }
  if (schemaCreated && admin?.isInitialized) { try { await admin.query(`DROP SCHEMA ${quotedSchema()} CASCADE`); } catch { failed = true; } }
  if (admin?.isInitialized) { try { await admin.destroy(); } catch { failed = true; } }
  if (failed) throw new Error('No se pudo eliminar el esquema temporal.');
}

let verified = false;
try { await verify(); verified = true; }
catch (error: unknown) {
  const detail = error instanceof QueryFailedError ? `PostgreSQL ${code(error) ?? 'desconocido'}` : error instanceof Error ? error.message : 'error desconocido';
  console.error(`Falló la verificación aislada de carga tutorial en ${step}: ${detail}. No se modificó el esquema configurado.`);
  process.exitCode = 1;
} finally { try { await cleanup(); } catch { console.error('No se pudo limpiar el esquema temporal de carga tutorial.'); process.exitCode = 1; } }

if (verified && process.exitCode !== 1) console.info('Migración, prioridad efectiva, unicidad, auditoría atómica y reversión de carga tutorial verificadas en esquema temporal.');
