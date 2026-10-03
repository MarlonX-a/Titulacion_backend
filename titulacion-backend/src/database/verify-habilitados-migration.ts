import { randomBytes } from 'node:crypto';
import { ConflictException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { loadEnvironment } from '../config/load-environment.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { EstudiantesService } from '../estudiantes/estudiantes.service.js';
import { EstudianteHabilitado } from '../habilitados/entities/estudiante-habilitado.entity.js';
import { HabilitadosService } from '../habilitados/habilitados.service.js';
import { CondicionIngreso } from '../habilitados/enums/condicion-ingreso.enum.js';
import { SituacionIngreso } from '../habilitados/enums/situacion-ingreso.enum.js';
import { HabilitadoEstado } from '../habilitados/enums/habilitado-estado.enum.js';
import { HabilitadoOrigen } from '../habilitados/enums/habilitado-origen.enum.js';
import { LoteImportacion } from '../importaciones/entities/lote-importacion.entity.js';
import { Auditoria } from '../auditoria/entities/auditoria.entity.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CreateUsuario20261002000000 } from './migrations/20261002000000-CreateUsuario.js';
import { CreateEstudianteDocente20261002010000 } from './migrations/20261002010000-CreateEstudianteDocente.js';
import { CreatePeriodoTitulacion20261002020000 } from './migrations/20261002020000-CreatePeriodoTitulacion.js';
import { CreateHabilitados20261002030000 } from './migrations/20261002030000-CreateHabilitados.js';
import { createDatabaseOptions } from './database.options.js';
import { DatabaseDataSource } from './database-data-source.js';

const schema = `test_habilitados_${randomBytes(8).toString('hex')}`;
let schemaCreated = false;
let verificationStep = 'conexión y migraciones';
let adminDataSource: DatabaseDataSource | undefined;
let isolatedDataSource: DatabaseDataSource | undefined;

function schemaIdentifier(): string {
  if (!/^test_habilitados_[a-f0-9]{16}$/.test(schema)) throw new Error('El esquema de verificación no es válido.');
  return `"${schema}"`;
}

function code(error: unknown): string | undefined {
  return error instanceof QueryFailedError
    ? (error.driverError as { code?: string }).code
    : undefined;
}

async function rejectedByCheck(sql: string, values: unknown[]): Promise<boolean> {
  try {
    await isolatedDataSource!.query(sql, values);
    return false;
  } catch (error: unknown) {
    return code(error) === '23514';
  }
}

async function verify(): Promise<void> {
  const options = createDatabaseOptions(loadEnvironment());
  adminDataSource = new DatabaseDataSource({ ...options, schema: 'public', entities: [], migrations: [] });
  await adminDataSource.initialize();
  await adminDataSource.query(`CREATE SCHEMA ${schemaIdentifier()}`);
  schemaCreated = true;

  isolatedDataSource = new DatabaseDataSource({
    ...options,
    schema,
    entities: [Usuario, Estudiante, Docente, PeriodoTitulacion, EstudianteHabilitado, LoteImportacion, Auditoria],
    migrations: [CreateUsuario20261002000000, CreateEstudianteDocente20261002010000, CreatePeriodoTitulacion20261002020000, CreateHabilitados20261002030000],
  });
  await isolatedDataSource.initialize();
  await isolatedDataSource.runMigrations({ transaction: 'all' });

  verificationStep = 'creación de datos temporales';
  const users = isolatedDataSource.getRepository(Usuario);
  verificationStep = 'creación del administrador de prueba';
  const actor = await users.save(users.create({
    email: 'admin@verification.example', nombres: 'Admin', apellidos: 'Verificación',
    rol: UsuarioRol.ADMIN, estado: UsuarioEstado.ACTIVO,
    id_externo_sso: 'verify-admin', ultimo_acceso: null,
  }));
  const students = isolatedDataSource.getRepository(Estudiante);
  const studentProfiles: Estudiante[] = [];
  for (const [index, cedula] of ['0102030400', '0102030418', '3002030405'].entries()) {
    verificationStep = `creación de estudiante de prueba ${index + 1}`;
    const user = await users.save(users.create({
      email: `student${index}@verification.example`, nombres: `Estudiante ${index}`,
      apellidos: 'Verificación', rol: UsuarioRol.ESTUDIANTE, estado: UsuarioEstado.ACTIVO,
      id_externo_sso: `verify-student-${index}`, ultimo_acceso: null,
    }));
    studentProfiles.push(await students.save(students.create({
      usuario: user, cedula, matricula: `VERIFY-${index}`, carrera: 'Sistemas', nivel: 5,
    })));
  }

  const periodRepo = isolatedDataSource.getRepository(PeriodoTitulacion);
  verificationStep = 'creación de período de prueba';
  const period = await periodRepo.save(periodRepo.create({
    codigo: 'VERIFY-HABILITADOS', nombre: 'Verificación aislada',
    fecha_inicio_postulacion: new Date('2026-11-02T13:00:00Z'),
    fecha_fin_postulacion: new Date('2026-12-01T04:59:00Z'),
    fecha_inicio_titulacion: new Date('2026-12-01T13:00:00Z'),
    estado: PeriodoEstado.BORRADOR, max_integrantes_default: 5,
  }));
  const service = new HabilitadosService(
    isolatedDataSource.getRepository(EstudianteHabilitado),
    isolatedDataSource,
    new EstudiantesService(students, isolatedDataSource),
    new AuditoriaService(),
  );
  const conditional = {
    estudiante_id: studentProfiles[0].id,
    condicion_ingreso: CondicionIngreso.CONDICIONADO,
    requisito_pendiente: 'Completar el requisito de verificación',
  };

  verificationStep = 'alta condicionada y auditoría';
  const pending = await service.create(period.id, actor, conditional, null);
  if (pending.situacion_ingreso !== SituacionIngreso.PENDIENTE || pending.estado !== HabilitadoEstado.HABILITADO) {
    throw new Error('El alta condicionada no produjo la situación esperada.');
  }

  verificationStep = 'altas concurrentes';
  const concurrentCreates = await Promise.allSettled([
    service.create(period.id, actor, { ...conditional, estudiante_id: studentProfiles[1].id }, null),
    service.create(period.id, actor, { ...conditional, estudiante_id: studentProfiles[1].id }, null),
  ]);
  const createSuccess = concurrentCreates.filter((result) => result.status === 'fulfilled').length;
  const createConflicts = concurrentCreates.filter((result) => result.status === 'rejected' && result.reason instanceof ConflictException).length;
  if (createSuccess !== 1 || createConflicts !== 1) throw new Error('La restricción única no protegió altas concurrentes.');

  verificationStep = 'resolución concurrente';
  const concurrentResolutions = await Promise.allSettled([
    service.resolve(period.id, pending.id, actor, { situacion_ingreso: SituacionIngreso.ADMITIDO }, null),
    service.resolve(period.id, pending.id, actor, { situacion_ingreso: SituacionIngreso.NO_ADMITIDO, observacion_ingreso: 'Verificación concurrente' }, null),
  ]);
  const resolutionSuccess = concurrentResolutions.filter((result) => result.status === 'fulfilled').length;
  const resolutionConflicts = concurrentResolutions.filter((result) => result.status === 'rejected' && result.reason instanceof ConflictException).length;
  if (resolutionSuccess !== 1 || resolutionConflicts !== 1) throw new Error('La resolución concurrente no fue exclusiva.');

  verificationStep = 'restricciones CHECK';
  const habilitadoTable = `${schemaIdentifier()}."estudiante_habilitado"`;
  const invalidRegular = await rejectedByCheck(
    `INSERT INTO ${habilitadoTable} ("periodo_id", "estudiante_id", "origen", "estado", "condicion_ingreso", "requisito_pendiente", "situacion_ingreso") VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [period.id, studentProfiles[2].id, HabilitadoOrigen.MANUAL, HabilitadoEstado.HABILITADO, CondicionIngreso.REGULAR, 'Requisito inválido', SituacionIngreso.ADMITIDO],
  );
  if (!invalidRegular) throw new Error('PostgreSQL permitió un requisito en una habilitación REGULAR.');

  verificationStep = 'atomicidad de auditoría';
  const auditTable = `${schemaIdentifier()}."auditoria"`;
  const functionName = `${schemaIdentifier()}."rechazar_auditoria_verificacion"`;
  await isolatedDataSource.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo de auditoría'; END; $$`);
  await isolatedDataSource.query(`CREATE TRIGGER "TRG_verify_audit_failure" BEFORE INSERT ON ${auditTable} FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
  let auditFailureControlled = false;
  try {
    await service.create(period.id, actor, { ...conditional, estudiante_id: studentProfiles[2].id }, null);
  } catch (error: unknown) {
    auditFailureControlled = error instanceof ServiceUnavailableException;
  }
  await isolatedDataSource.query(`DROP TRIGGER "TRG_verify_audit_failure" ON ${auditTable}`);
  await isolatedDataSource.query(`DROP FUNCTION ${functionName}()`);
  const persistedAfterFailure = await isolatedDataSource.getRepository(EstudianteHabilitado).countBy({ estudiante: { id: studentProfiles[2].id } });
  if (!auditFailureControlled || persistedAfterFailure !== 0) throw new Error('La auditoría no fue atómica con la habilitación.');

  const auditCount = await isolatedDataSource.getRepository(Auditoria).count();
  if (auditCount !== 3) throw new Error('Faltan registros de auditoría para las operaciones verificadas.');

  verificationStep = 'protección de reversión';
  let protectedDown = false;
  try {
    await isolatedDataSource.undoLastMigration();
  } catch (error: unknown) {
    protectedDown = error instanceof Error && error.message.includes('existen habilitaciones, lotes o auditorías');
  }
  if (!protectedDown || await isolatedDataSource.getRepository(EstudianteHabilitado).count() !== 2) {
    throw new Error('La reversión no protegió los datos de habilitados.');
  }
}

async function cleanup(): Promise<void> {
  let failed = false;
  if (isolatedDataSource?.isInitialized) {
    try { await isolatedDataSource.destroy(); } catch { failed = true; }
  }
  if (schemaCreated && adminDataSource?.isInitialized) {
    try { await adminDataSource.query(`DROP SCHEMA ${schemaIdentifier()} CASCADE`); } catch { failed = true; }
  }
  if (adminDataSource?.isInitialized) {
    try { await adminDataSource.destroy(); } catch { failed = true; }
  }
  if (failed) throw new Error('No se pudo limpiar el esquema temporal de verificación.');
}

let verified = false;
try {
  await verify();
  verified = true;
} catch (error: unknown) {
  const cause = error instanceof HttpException ? error.cause : error;
  const diagnostic = cause instanceof QueryFailedError
    ? `error PostgreSQL ${code(cause) ?? 'desconocido'}`
    : error instanceof Error ? error.message : 'error desconocido';
  console.error(`Falló la verificación aislada durante ${verificationStep}: ${diagnostic}. No se modificó el esquema configurado.`);
  process.exitCode = 1;
} finally {
  try { await cleanup(); } catch {
    console.error('No se pudo limpiar el esquema temporal de verificación.');
    process.exitCode = 1;
  }
}

if (verified && process.exitCode !== 1) {
  console.info('Migraciones, restricciones, concurrencia, auditoría atómica y reversión verificadas en esquema temporal.');
}
