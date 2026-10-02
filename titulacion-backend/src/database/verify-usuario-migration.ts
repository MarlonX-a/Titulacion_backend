import { randomBytes } from 'node:crypto';
import { DatabaseDataSource } from './database-data-source.js';
import { loadEnvironment } from '../config/load-environment.js';
import { createDatabaseOptions } from './database.options.js';
import { CreateUsuario20261002000000 } from './migrations/20261002000000-CreateUsuario.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuariosService } from '../usuarios/usuarios.service.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { ConflictException } from '@nestjs/common';
import { provisionLocalDemoAccounts } from '../auth/local/provision-local-demo-accounts.js';

const schema = `test_usuario_${randomBytes(8).toString('hex')}`;
let schemaCreated = false;
let adminDataSource: DatabaseDataSource | undefined;
let isolatedDataSource: DatabaseDataSource | undefined;

function schemaIdentifier(): string {
  if (!/^test_usuario_[a-f0-9]{16}$/.test(schema)) {
    throw new Error('El esquema temporal generado no es válido.');
  }
  return `"${schema}"`;
}

async function verify(): Promise<void> {
  const environment = loadEnvironment();
  const baseOptions = createDatabaseOptions(environment);
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
    entities: [Usuario],
    migrations: [CreateUsuario20261002000000],
  });
  await isolatedDataSource.initialize();
  await isolatedDataSource.runMigrations({ transaction: 'all' });

  const service = new UsuariosService(
    isolatedDataSource.getRepository(Usuario),
    isolatedDataSource,
  );
  const details = {
    email: 'bootstrap@universidad.example',
    nombres: 'Administrador',
    apellidos: 'Temporal',
    id_externo_sso: 'test-bootstrap-sub',
  };
  const results = await Promise.allSettled([
    service.createInitialAdmin(details),
    service.createInitialAdmin({
      ...details,
      email: 'segundo@universidad.example',
      id_externo_sso: 'test-bootstrap-sub-2',
    }),
  ]);
  const succeeded = results.filter(
    (result) => result.status === 'fulfilled',
  ).length;
  const conflicted = results.filter(
    (result) =>
      result.status === 'rejected' &&
      result.reason instanceof ConflictException,
  ).length;

  if (succeeded !== 1 || conflicted !== 1) {
    throw new Error('La inicialización concurrente del ADMIN no fue atómica.');
  }

  const admin = await isolatedDataSource
    .getRepository(Usuario)
    .findOneByOrFail({ rol: UsuarioRol.ADMIN });
  const duplicateInputs = [
    {
      ...details,
      email: 'BOOTSTRAP@UNIVERSIDAD.EXAMPLE',
      rol: UsuarioRol.ADMIN,
      id_externo_sso: 'different-sub',
    },
    {
      ...details,
      email: 'different@universidad.example',
      rol: UsuarioRol.ADMIN,
    },
  ];
  for (const input of duplicateInputs) {
    let rejected = false;
    try {
      await service.create(input);
    } catch (error: unknown) {
      rejected = error instanceof ConflictException;
    }
    if (!rejected) {
      throw new Error('Una restricción única no rechazó un duplicado.');
    }
  }

  await provisionLocalDemoAccounts(isolatedDataSource);
  await provisionLocalDemoAccounts(isolatedDataSource);
  const demoAdmin = await isolatedDataSource
    .getRepository(Usuario)
    .findOneByOrFail({ email: 'admin@example.test' });
  if (
    (await isolatedDataSource.getRepository(Usuario).count()) !== 4 ||
    demoAdmin.id_externo_sso !== 'local-demo-admin'
  ) {
    throw new Error('Las cuentas locales no se prepararon de forma idempotente.');
  }

  await isolatedDataSource
    .getRepository(Usuario)
    .update({ id: demoAdmin.id }, { rol: UsuarioRol.DOCENTE });
  let conflictingProvisionRejected = false;
  try {
    await provisionLocalDemoAccounts(isolatedDataSource);
  } catch (error: unknown) {
    conflictingProvisionRejected = error instanceof ConflictException;
  }
  const unchangedDemoAdmin = await isolatedDataSource
    .getRepository(Usuario)
    .findOneByOrFail({ id: demoAdmin.id });
  if (
    !conflictingProvisionRejected ||
    unchangedDemoAdmin.rol !== UsuarioRol.DOCENTE
  ) {
    throw new Error('La preparación alteró una cuenta local incompatible.');
  }
  await isolatedDataSource
    .getRepository(Usuario)
    .update({ id: demoAdmin.id }, { rol: UsuarioRol.ADMIN });

  let downProtected = false;
  try {
    await isolatedDataSource.undoLastMigration();
  } catch (error: unknown) {
    downProtected =
      error instanceof Error &&
      error.message.includes('la tabla usuario contiene registros');
  }
  if (!downProtected) {
    throw new Error('La reversión no protegió los registros existentes.');
  }
  const preservedAdmins = await isolatedDataSource
    .getRepository(Usuario)
    .countBy({ id: admin.id });
  if (preservedAdmins !== 1) {
    throw new Error('La verificación de reversión afectó datos de usuario.');
  }
}

async function closeDataSources(): Promise<void> {
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

  if (cleanupFailed) {
    throw new Error('No se pudo limpiar el esquema temporal.');
  }
}

let verified = false;
try {
  await verify();
  verified = true;
} catch {
  console.error(
    'Falló la verificación aislada de la migración de usuarios. La base pública no se modificó.',
  );
  process.exitCode = 1;
} finally {
  try {
    await closeDataSources();
  } catch {
    console.error('No se pudo limpiar el esquema temporal de verificación.');
    process.exitCode = 1;
  }
}

if (verified && process.exitCode !== 1) {
  console.info(
    'Migración usuario, cuentas locales idempotentes, restricciones e inicialización concurrente verificadas en esquema temporal.',
  );
}
