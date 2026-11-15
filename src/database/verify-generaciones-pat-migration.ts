import { runTemporarySchemaVerification } from './verify-temp-schema.js';
import { GeneracionPatIndividual20261107100000 } from './migrations/20261107100000-GeneracionPatIndividual.js';

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
    step('reversión protegida sobre tablas vacías');
    const migration = new GeneracionPatIndividual20261107100000();
    const runner=db.createQueryRunner(); await runner.connect(); await runner.startTransaction();
    try { await migration.down(runner); await runner.commitTransaction(); }
    catch(error:unknown){if(runner.isTransactionActive)await runner.rollbackTransaction();throw error;}
    finally{await runner.release();}
    const removed=await db.query(`SELECT to_regclass($1) IS NULL AS removed`,[`${schema}.generacion_pat`]) as Array<{removed:boolean}>;
    if(!removed[0]?.removed)throw new Error('La reversión no retiró las tablas de generación vacías.');
    // The schema is disposable; no rows or live development objects were touched.
    void schemaSql;
  },
});
