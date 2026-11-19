import { runTemporarySchemaVerification } from './verify-temp-schema.js';
import type { DatabaseDataSource } from './database-data-source.js';
import { GeneracionPatIndividual20261107100000 } from './migrations/20261107100000-GeneracionPatIndividual.js';
import { PatAutomatico20261119100000 } from './migrations/20261119100000-PatAutomatico.js';

async function revertir(db: DatabaseDataSource, migration: { down(runner: import('typeorm').QueryRunner): Promise<void> }): Promise<void> {
  const runner = db.createQueryRunner(); await runner.connect(); await runner.startTransaction();
  try { await migration.down(runner); await runner.commitTransaction(); }
  catch (error: unknown) { if (runner.isTransactionActive) await runner.rollbackTransaction(); throw error; }
  finally { await runner.release(); }
}

const definicion = async (db: DatabaseDataSource, signature: string): Promise<string> =>
  ((await db.query(`SELECT pg_get_functiondef(to_regprocedure($1)) AS def`, [signature]) as Array<{ def: string | null }>)[0]?.def ?? '');

void runTemporarySchemaVerification({
  prefix: 'verify_genpat',
  subject: 'generación PAT individual',
  cleanupSubject: 'generación PAT individual',
  success: 'Migración de generación PAT individual y reversión protegida verificadas en esquema aislado.',
  async verify({ db, schema, schemaSql, step }) {
    step('entidades, integridad y referencias de estudiante');
    const tables = await db.query(`SELECT to_regclass($1) IS NOT NULL AS datos,to_regclass($2) IS NOT NULL AS contenido,to_regclass($3) IS NOT NULL AS generacion`, [`${schema}.estudiante_datos_pat`, `${schema}.contenido_pat_estudiante`, `${schema}.generacion_pat`]) as Array<{ datos:boolean; contenido:boolean; generacion:boolean }>;
    if (!tables[0]?.datos || !tables[0]?.contenido || !tables[0]?.generacion) throw new Error('Faltan tablas PAT individual en la migración.');
    const indexes = await db.query(`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname IN ('UQ_documento_pat_asignacion_version_legacy','UQ_documento_pat_estudiante_version')`, [schema]) as Array<{indexname:string;indexdef:string}>;
    if(indexes.length!==2 || !indexes.some((row)=>row.indexname==='UQ_documento_pat_estudiante_version'&&row.indexdef.includes('estudiante_id'))) throw new Error('No se instaló la unicidad de versiones individuales.');
    const triggers = await db.query(`SELECT to_regprocedure($1) IS NOT NULL AS generation_trigger`, [`${schema}.proteger_generacion_pat()`]) as Array<{generation_trigger:boolean}>;
    if(!triggers[0]?.generation_trigger) throw new Error('No está instalada la protección de inmutabilidad de generaciones.');
    step('PAT automático: origen de documentos, recuperación de atascadas y reversión');
    const columns = await db.query(`SELECT table_name, column_name, column_default, is_nullable FROM information_schema.columns WHERE table_schema=$1 AND ((table_name='documento_pat' AND column_name='origen') OR (table_name='generacion_pat' AND column_name='procesando_desde'))`, [schema]) as Array<{ table_name: string; column_name: string; column_default: string | null; is_nullable: string }>;
    const origen = columns.find((c) => c.column_name === 'origen');
    if (!origen || origen.is_nullable !== 'NO' || !origen.column_default?.includes('FIRMADO') || !columns.some((c) => c.column_name === 'procesando_desde' && c.is_nullable === 'YES')) throw new Error('Faltan documento_pat.origen (NOT NULL, FIRMADO) o generacion_pat.procesando_desde.');
    const unique = await db.query(`SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname='UQ_documento_pat_generacion_entregada'`, [schema]) as Array<{ indexdef: string }>;
    if (!unique[0]?.indexdef.includes('UNIQUE') || !unique[0].indexdef.includes('GENERADO')) throw new Error('Falta la unicidad de entrega por generación.');
    const checks = await db.query(`SELECT conname FROM pg_constraint WHERE conrelid=to_regclass($1) AND conname IN ('CHK_documento_pat_origen','CHK_documento_pat_origen_generacion')`, [`${schema}.documento_pat`]) as unknown[];
    if (checks.length !== 2) throw new Error('Faltan las restricciones de origen del documento PAT.');
    if (!(await definicion(db, `${schema}.proteger_generacion_pat()`)).includes(`OLD."estado" IN ('FALLIDO','PROCESANDO') AND NEW."estado"='EN_COLA'`)) throw new Error('La protección de generaciones no admite recuperar atascadas.');
    const documento = await definicion(db, `${schema}.proteger_documento_pat()`);
    if (!documento.includes(`NEW."origen"='GENERADO' AND (NEW."ruta_almacenamiento"<>v_gen_ruta`) || !documento.includes(`NEW."origen"<>'GENERADO' AND NOT EXISTS`)) throw new Error('La protección de documentos no distingue la entrega generada.');
    await revertir(db, new PatAutomatico20261119100000());
    const reverted = await db.query(`SELECT count(*)::int AS total FROM information_schema.columns WHERE table_schema=$1 AND column_name IN ('origen','procesando_desde') AND table_name IN ('documento_pat','generacion_pat')`, [schema]) as Array<{ total: number }>;
    if (reverted[0]?.total !== 0) throw new Error('La reversión del PAT automático no retiró sus columnas.');
    if ((await definicion(db, `${schema}.proteger_generacion_pat()`)).includes(`'PROCESANDO') AND NEW."estado"='EN_COLA'`)) throw new Error('La reversión no restauró la protección de generaciones.');
    step('reversión protegida sobre tablas vacías');
    await revertir(db, new GeneracionPatIndividual20261107100000());
    const removed=await db.query(`SELECT to_regclass($1) IS NULL AS removed`,[`${schema}.generacion_pat`]) as Array<{removed:boolean}>;
    if(!removed[0]?.removed)throw new Error('La reversión no retiró las tablas de generación vacías.');
    // The schema is disposable; no rows or live development objects were touched.
    void schemaSql;
  },
});
