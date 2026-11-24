import { runTemporarySchemaVerification, undoMigrationsThrough, type TemporarySchemaContext } from './verify-temp-schema.js';

const MIGRACION = 'EquiposAdmin20261123120000';

/**
 * Verifies the structure of migration 20261123120000 (admin teams) and its protected rollback in an
 * isolated schema. The behaviour (endpoints and triggers) is covered by
 * `test/attack/equipos-admin.attack-spec.ts`.
 */
await runTemporarySchemaVerification({
  prefix: 'test_equipos',
  subject: 'de los equipos administrativos',
  cleanupSubject: 'de los equipos administrativos',
  success: 'Equipos administrativos (origen de asignación, candidatos a tutor, tipo CANDIDATO_CONFIRMADO, reversión y reaplicación) verificados en esquema temporal.',
  async verify(context) { await verificar(context); },
});

async function estructura({ db, schema }: TemporarySchemaContext): Promise<{ origen: boolean; candidatos: boolean; columnaCandidato: boolean; tipos: string[]; postulacionNullable: boolean }> {
  const [fila] = await db.query(`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name='asignacion_tema' AND column_name='origen') AS origen,
           EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name='candidato_tutor') AS candidatos,
           EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name='asignacion_tutor' AND column_name='candidato_tutor_id') AS "columnaCandidato",
           (SELECT is_nullable='YES' FROM information_schema.columns WHERE table_schema=$1 AND table_name='asignacion_tema' AND column_name='postulacion_id') AS "postulacionNullable",
           ARRAY(SELECT e.enumlabel::text FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND t.typname='asignacion_tutor_tipo_enum' ORDER BY e.enumsortorder) AS tipos`, [schema]) as Array<{ origen: boolean; candidatos: boolean; columnaCandidato: boolean; tipos: string[]; postulacionNullable: boolean }>;
  return fila!;
}

async function verificar(context: TemporarySchemaContext): Promise<void> {
  const { db, schemaSql, step } = context;
  step('estructura aplicada');
  const aplicada = await estructura(context);
  if (!aplicada.origen || !aplicada.candidatos || !aplicada.columnaCandidato || !aplicada.postulacionNullable || !aplicada.tipos.includes('CANDIDATO_CONFIRMADO')) throw new Error('La migración no dejó la estructura de equipos administrativos.');

  step('reversión');
  await undoMigrationsThrough(db, schemaSql, MIGRACION);
  const revertida = await estructura(context);
  if (revertida.origen || revertida.candidatos || revertida.columnaCandidato || revertida.postulacionNullable || revertida.tipos.join(',') !== 'PROPUESTO_CONFIRMADO,ASIGNADO_DIRECTO') throw new Error('La reversión no restauró la estructura anterior.');

  step('reaplicación');
  await db.runMigrations({ transaction: 'all' });
  const reaplicada = await estructura(context);
  if (!reaplicada.origen || !reaplicada.candidatos) throw new Error('La migración no se pudo volver a aplicar.');
}
