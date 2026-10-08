import { randomBytes } from 'node:crypto';
import { QueryFailedError } from 'typeorm';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { CreateUsuario20261002000000 } from './migrations/20261002000000-CreateUsuario.js';
import { CreatePeriodoTitulacion20261002020000 } from './migrations/20261002020000-CreatePeriodoTitulacion.js';
import { CreatePlantillasPat20261009100000 } from './migrations/20261009100000-CreatePlantillasPat.js';
import { loadEnvironment } from '../config/load-environment.js';
import { createDatabaseOptions } from './database.options.js';
import { DatabaseDataSource } from './database-data-source.js';

const schema = `test_plantillas_pat_${randomBytes(8).toString('hex')}`;
const schemaSql = () => {
  if (!/^test_plantillas_pat_[a-f0-9]{16}$/.test(schema)) throw new Error('Esquema temporal inválido.');
  return `"${schema}"`;
};
const code = (error: unknown) => error instanceof QueryFailedError ? (error.driverError as { code?: string }).code : undefined;
let admin: DatabaseDataSource | undefined;
let isolated: DatabaseDataSource | undefined;
let schemaCreated = false;
let step = 'conexión y migración';

async function verify(): Promise<void> {
  const options = createDatabaseOptions(loadEnvironment());
  admin = new DatabaseDataSource({ ...options, schema: 'public', entities: [], migrations: [] });
  await admin.initialize();
  await admin.query(`CREATE SCHEMA ${schemaSql()}`);
  schemaCreated = true;
  isolated = new DatabaseDataSource({
    ...options,
    schema,
    migrations: [CreateUsuario20261002000000, CreatePeriodoTitulacion20261002020000, CreatePlantillasPat20261009100000],
  });
  await isolated.initialize();
  await isolated.runMigrations({ transaction: 'all' });
  const user = await isolated.getRepository(Usuario).save(isolated.getRepository(Usuario).create({
    email: 'admin@plantillas.verify', nombres: 'Admin', apellidos: 'Verificación', rol: UsuarioRol.ADMIN, estado: UsuarioEstado.ACTIVO, id_externo_sso: 'plantillas-admin', ultimo_acceso: null,
  }));
  const periodRepo = isolated.getRepository(PeriodoTitulacion);
  const makePeriod = (codigo: string) => periodRepo.save(periodRepo.create({
    codigo, nombre: 'Período de verificación', fecha_inicio_postulacion: new Date('2026-01-01T00:00:00Z'),
    fecha_fin_postulacion: new Date('2026-02-01T00:00:00Z'), fecha_inicio_titulacion: new Date('2026-02-01T00:00:00Z'),
    estado: PeriodoEstado.BORRADOR, max_integrantes_default: 4,
  }));
  const period = await makePeriod('PAT-VERIFY');
  const secondPeriod = await makePeriod('PAT-RACE');
  const insert = (periodId: string, version: string) => isolated!.query(
    `INSERT INTO ${schemaSql()}."plantilla_pat" ("periodo_id","version","nombre_archivo","ruta_almacenamiento","mime_type","tamano_bytes","hash_sha256","fecha_vigencia_inicio","publicada_por_id","activa") VALUES ($1,$2,'plantilla.pdf','plantillas-pat/verify.pdf','application/pdf',12,$3,'2026-10-07',$4,true)`,
    [periodId, version, 'a'.repeat(64), user.id],
  );

  step = 'unicidad de versión y plantilla activa';
  await insert(period.id, '1');
  const duplicateVersion = await insert(period.id, '1').then(() => false, (error: unknown) => code(error) === '23505');
  if (!duplicateVersion) throw new Error('La misma versión se permitió dos veces en el período.');
  const activeConflict = await insert(period.id, '2').then(() => false, (error: unknown) => code(error) === '23505');
  if (!activeConflict) throw new Error('Se permitió más de una plantilla activa en el período.');

  step = 'exclusión concurrente de dos publicaciones';
  const simultaneous = await Promise.allSettled([insert(secondPeriod.id, 'A'), insert(secondPeriod.id, 'B')]);
  if (simultaneous.filter((result) => result.status === 'fulfilled').length !== 1) throw new Error('Dos publicaciones concurrentes quedaron activas para el mismo período.');

  step = 'versiones históricas inmutables';
  const mutationRejected = await isolated.query(`UPDATE ${schemaSql()}."plantilla_pat" SET "version"='alterada' WHERE "periodo_id"=$1`, [period.id]).then(() => false, (error: unknown) => code(error) === '23514');
  if (!mutationRejected) throw new Error('La base permitió modificar la etiqueta histórica de una plantilla.');

  step = 'rechazo de publicación en período archivado';
  await periodRepo.update(period.id, { estado: PeriodoEstado.ARCHIVADO });
  const archivedRejected = await insert(period.id, '3').then(() => false, (error: unknown) => code(error) === '23514');
  if (!archivedRejected) throw new Error('La base permitió publicar en un período archivado.');

  step = 'reversión protegida con historial';
  const runner = isolated.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  const migration = new CreatePlantillasPat20261009100000();
  const protectedDown = await migration.down(runner).then(() => false, async (error: unknown) => {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    return error instanceof Error && error.message.includes('existen versiones');
  });
  if (runner.isTransactionActive) await runner.rollbackTransaction();
  await runner.release();
  if (!protectedDown) throw new Error('La migración permitió borrar versiones históricas.');
  console.log('Verificación de plantillas PAT correcta: migración, unicidad, concurrencia, publicación por período y reversión protegida.');
}

try { await verify(); }
catch (error: unknown) {
  const detail = error instanceof Error ? error.message : 'error no especificado';
  console.error(`Falló la verificación de plantillas PAT durante ${step}: ${detail}`);
  process.exitCode = 1;
}
finally {
  if (isolated?.isInitialized) await isolated.destroy().catch(() => undefined);
  if (admin?.isInitialized && schemaCreated) await admin.query(`DROP SCHEMA IF EXISTS ${schemaSql()} CASCADE`).catch(() => undefined);
  if (admin?.isInitialized) await admin.destroy().catch(() => undefined);
}
