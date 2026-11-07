import { randomBytes } from 'node:crypto';
import { QueryFailedError } from 'typeorm';
import { loadEnvironment } from '../config/load-environment.js';
import { DatabaseDataSource } from './database-data-source.js';
import { createDatabaseOptions } from './database.options.js';

/** Código SQLSTATE de PostgreSQL de un error de consulta, si lo hay. */
export const pgErrorCode = (error: unknown): string | undefined =>
  error instanceof QueryFailedError ? (error.driverError as { code?: string }).code : undefined;

export interface TemporarySchemaContext {
  /** Conexión al esquema temporal con todas las migraciones ejecutadas. */
  db: DatabaseDataSource;
  /** Nombre del esquema temporal (para parámetros de consulta). */
  schema: string;
  /** Nombre del esquema temporal validado y entre comillas (para interpolar en SQL). */
  schemaSql: string;
  /** Registra el paso en curso para el mensaje de error. */
  step(name: string): void;
}

export interface TemporarySchemaVerification {
  /** Prefijo del esquema temporal (solo minúsculas y guion bajo), p. ej. `test_faccar`. */
  prefix: string;
  /** Complemento del mensaje de error: «Falló la verificación {subject} en …». */
  subject: string;
  /** Complemento del mensaje de limpieza: «No se pudo limpiar el esquema temporal {cleanupSubject}.». */
  cleanupSubject: string;
  /** Mensaje informativo cuando la verificación termina sin errores. */
  success: string;
  /** Registers the application entities on the isolated connection so services and repositories can run. */
  withEntities?: boolean;
  verify(context: TemporarySchemaContext): Promise<void>;
}

/**
 * Ejecuta las migraciones en un esquema temporal aislado, corre la verificación y elimina el esquema.
 * Nunca modifica el esquema configurado; ante cualquier fallo deja `process.exitCode = 1`.
 */
export async function runTemporarySchemaVerification(verification: TemporarySchemaVerification): Promise<void> {
  if (!/^[a-z_]+$/.test(verification.prefix)) throw new Error('El prefijo del esquema temporal no es válido.');
  const schema = `${verification.prefix}_${randomBytes(8).toString('hex')}`;
  const pattern = new RegExp(`^${verification.prefix}_[a-f0-9]{16}$`);
  const schemaSql = (): string => {
    if (!pattern.test(schema)) throw new Error('El esquema temporal no es válido.');
    return `"${schema}"`;
  };
  let admin: DatabaseDataSource | undefined;
  let isolated: DatabaseDataSource | undefined;
  let created = false;
  let step = 'conexión y migraciones';

  async function verify(): Promise<void> {
    const options = createDatabaseOptions(loadEnvironment());
    const adminSource = new DatabaseDataSource({ ...options, schema: 'public', entities: [], migrations: [] });
    admin = adminSource;
    await adminSource.initialize();
    await adminSource.query(`CREATE SCHEMA ${schemaSql()}`);
    created = true;
    const db = new DatabaseDataSource({ ...options, schema, entities: verification.withEntities ? options.entities : [] });
    isolated = db;
    await db.initialize();
    await db.runMigrations({ transaction: 'all' });
    await verification.verify({ db, schema, schemaSql: schemaSql(), step: (name) => { step = name; } });
  }

  async function cleanup(): Promise<void> {
    // Orden obligatorio: cerrar la conexión aislada, eliminar el esquema y cerrar la conexión administrativa.
    const isolatedOpen = isolated?.isInitialized === true ? isolated : undefined;
    const adminOpen = admin?.isInitialized === true ? admin : undefined;
    const tasks: Array<(() => Promise<unknown>) | undefined> = [
      isolatedOpen && (() => isolatedOpen.destroy()),
      created && adminOpen ? () => adminOpen.query(`DROP SCHEMA ${schemaSql()} CASCADE`) : undefined,
      adminOpen && (() => adminOpen.destroy()),
    ];
    const outcomes: boolean[] = [];
    for (const task of tasks) {
      if (task) outcomes.push(await task().then(() => true, () => false));
    }
    if (outcomes.includes(false)) throw new Error('No se pudo eliminar el esquema temporal.');
  }

  let verified = false;
  try { await verify(); verified = true; }
  catch (error: unknown) {
    const detail = error instanceof QueryFailedError ? `PostgreSQL ${pgErrorCode(error) ?? 'desconocido'}` : error instanceof Error ? error.message : 'error desconocido';
    console.error(`Falló la verificación ${verification.subject} en ${step}: ${detail}. No se modificó el esquema configurado.`);
    process.exitCode = 1;
  } finally { try { await cleanup(); } catch { console.error(`No se pudo limpiar el esquema temporal ${verification.cleanupSubject}.`); process.exitCode = 1; } }

  if (verified && process.exitCode !== 1) console.info(verification.success);
}
