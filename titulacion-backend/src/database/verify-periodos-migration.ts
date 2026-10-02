import { randomBytes } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { loadEnvironment } from '../config/load-environment.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodosService } from '../periodos/periodos.service.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { CreateUsuario20261002000000 } from './migrations/20261002000000-CreateUsuario.js';
import { CreateEstudianteDocente20261002010000 } from './migrations/20261002010000-CreateEstudianteDocente.js';
import { CreatePeriodoTitulacion20261002020000 } from './migrations/20261002020000-CreatePeriodoTitulacion.js';
import { createDatabaseOptions } from './database.options.js';
import { DatabaseDataSource } from './database-data-source.js';

const schema = `test_periodos_${randomBytes(8).toString('hex')}`;
let schemaCreated = false;
let adminDataSource: DatabaseDataSource | undefined;
let isolatedDataSource: DatabaseDataSource | undefined;

function schemaIdentifier(): string {
  if (!/^test_periodos_[a-f0-9]{16}$/.test(schema)) {
    throw new Error('El esquema temporal generado no es válido.');
  }
  return `"${schema}"`;
}

function isCheckViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as { code?: string };
  return driverError.code === '23514';
}

async function rejectedByDatabase(sql: string, values: unknown[]): Promise<boolean> {
  try {
    await isolatedDataSource!.query(sql, values);
    return false;
  } catch (error: unknown) {
    return isCheckViolation(error);
  }
}

async function verify(): Promise<void> {
  const baseOptions = createDatabaseOptions(loadEnvironment());
  adminDataSource = new DatabaseDataSource({
    ...baseOptions,
    entities: [],
    migrations: [],
  });
  await adminDataSource.initialize();
  await adminDataSource.query(`CREATE SCHEMA ${schemaIdentifier()}`);
  schemaCreated = true;

  isolatedDataSource = new DatabaseDataSource({
    ...baseOptions,
    schema,
    entities: [Usuario, Estudiante, Docente, PeriodoTitulacion],
    migrations: [
      CreateUsuario20261002000000,
      CreateEstudianteDocente20261002010000,
      CreatePeriodoTitulacion20261002020000,
    ],
  });
  await isolatedDataSource.initialize();
  await isolatedDataSource.runMigrations({ transaction: 'all' });

  const service = new PeriodosService(
    isolatedDataSource.getRepository(PeriodoTitulacion),
    isolatedDataSource,
  );
  const periodData = {
    codigo: 'VERIFY-PERIODO',
    nombre: 'Período temporal de verificación',
    fecha_inicio_postulacion: '2026-11-02T08:00:00-05:00',
    fecha_fin_postulacion: '2026-11-30T23:59:00-05:00',
    fecha_inicio_titulacion: '2026-12-01T08:00:00-05:00',
    max_integrantes_default: 5,
  };
  const created = await service.create(periodData);
  if (
    created.estado !== PeriodoEstado.BORRADOR ||
    created.fecha_inicio_postulacion.toISOString() !==
      '2026-11-02T13:00:00.000Z'
  ) {
    throw new Error('El período o la normalización horaria no son correctos.');
  }

  let uniqueConflict = false;
  try {
    await service.create({ ...periodData, nombre: 'Código duplicado' });
  } catch (error: unknown) {
    uniqueConflict = error instanceof ConflictException;
  }
  if (!uniqueConflict) {
    throw new Error('La restricción única de código no rechazó un duplicado.');
  }

  const table = `${schemaIdentifier()}."periodo_titulacion"`;
  const dates = [
    'fechas-invalidas',
    'Prueba de restricción',
    '2026-12-02T13:00:00Z',
    '2026-11-30T23:00:00Z',
    '2026-12-01T13:00:00Z',
    5,
  ];
  const dateConstraint = await rejectedByDatabase(
    `INSERT INTO ${table} ("codigo", "nombre", "fecha_inicio_postulacion", "fecha_fin_postulacion", "fecha_inicio_titulacion", "max_integrantes_default") VALUES ($1, $2, $3, $4, $5, $6)`,
    dates,
  );
  const maxConstraint = await rejectedByDatabase(
    `INSERT INTO ${table} ("codigo", "nombre", "fecha_inicio_postulacion", "fecha_fin_postulacion", "fecha_inicio_titulacion", "max_integrantes_default") VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      'maximo-invalido',
      'Prueba de restricción',
      '2026-11-02T13:00:00Z',
      '2026-12-01T04:59:00Z',
      '2026-12-01T13:00:00Z',
      0,
    ],
  );
  if (!dateConstraint || !maxConstraint) {
    throw new Error('PostgreSQL no rechazó una regla del período.');
  }

  const concurrentCreates = await Promise.allSettled([
    service.create({ ...periodData, codigo: 'CONCURRENT', nombre: 'Concurrente A' }),
    service.create({ ...periodData, codigo: 'CONCURRENT', nombre: 'Concurrente B' }),
  ]);
  const successCount = concurrentCreates.filter(
    (result) => result.status === 'fulfilled',
  ).length;
  const conflictCount = concurrentCreates.filter(
    (result) =>
      result.status === 'rejected' &&
      result.reason instanceof ConflictException,
  ).length;
  if (successCount !== 1 || conflictCount !== 1) {
    throw new Error('La restricción de código no protegió altas concurrentes.');
  }

  let downProtected = false;
  try {
    await isolatedDataSource.undoLastMigration();
  } catch (error: unknown) {
    downProtected =
      error instanceof Error &&
      error.message.includes('la tabla periodo_titulacion contiene registros');
  }
  const preservedCount = await isolatedDataSource
    .getRepository(PeriodoTitulacion)
    .count();
  if (!downProtected || preservedCount !== 2) {
    throw new Error('La reversión no protegió los períodos existentes.');
  }
}

async function cleanup(): Promise<void> {
  let cleanupFailed = false;
  if (isolatedDataSource?.isInitialized) {
    try {
      await isolatedDataSource.destroy();
    } catch {
      cleanupFailed = true;
    }
  }
  if (schemaCreated && adminDataSource?.isInitialized) {
    try {
      await adminDataSource.query(`DROP SCHEMA ${schemaIdentifier()} CASCADE`);
    } catch {
      cleanupFailed = true;
    }
  }
  if (adminDataSource?.isInitialized) {
    try {
      await adminDataSource.destroy();
    } catch {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed) throw new Error('No se pudo limpiar el esquema temporal.');
}

let verified = false;
try {
  await verify();
  verified = true;
} catch {
  console.error(
    'Falló la verificación aislada de períodos. La base pública no se modificó.',
  );
  process.exitCode = 1;
} finally {
  try {
    await cleanup();
  } catch {
    console.error('No se pudo limpiar el esquema temporal de verificación.');
    process.exitCode = 1;
  }
}

if (verified && process.exitCode !== 1) {
  console.info(
    'Migración, reglas PostgreSQL, unicidad concurrente y reversión de períodos verificadas en esquema temporal.',
  );
}
