import { pgErrorCode as code, runTemporarySchemaVerification } from './verify-temp-schema.js';

async function expectCheck(statement: () => Promise<unknown>, message: string): Promise<void> {
  let rejected = false;
  try { await statement(); } catch (error: unknown) { rejected = code(error) === '23514'; }
  if (!rejected) throw new Error(message);
}

await runTemporarySchemaVerification({
  prefix: 'test_impdoc',
  subject: 'de la importación de docentes',
  cleanupSubject: 'de importación de docentes',
  success: 'Migración de importación de docentes (tipo, período opcional por tipo y reversión protegida) verificada en esquema temporal.',
  async verify({ db, schema, schemaSql: s, step }) {
    step('datos de prueba');
    const userId = '00000000-0000-4000-8000-000000000001';
    const periodId = '00000000-0000-4000-8000-000000000002';
    await db.query(`INSERT INTO ${s}."usuario" ("id","email","nombres","apellidos","rol","estado","id_externo_sso") VALUES ($1,'verificador@uleam.edu.ec','Verificador','Importación','ADMIN','ACTIVO',NULL)`, [userId]);
    await db.query(`INSERT INTO ${s}."periodo_titulacion" ("id","codigo","nombre","fecha_inicio_postulacion","fecha_fin_postulacion","fecha_inicio_titulacion","estado","max_integrantes_default","facultad_id") VALUES ($1,'VERIFY','Verificación','2026-01-01','2026-02-01','2026-02-01','BORRADOR',3,(SELECT "id" FROM ${s}."facultad" ORDER BY "codigo" LIMIT 1))`, [periodId]);
    const insert = (tipo: string | null, periodo: string | null) => db.query(
      `INSERT INTO ${s}."preparacion_importacion" ("periodo_id","solicitada_por_id","nombre_archivo","ruta_almacenamiento","sha256","estado","expira_en"${tipo ? ',"tipo"' : ''}) VALUES ($1,$2,'a.xlsx','clave',repeat('a',64),'VALIDANDO',now() + interval '1 hour'${tipo ? ',$3' : ''})`,
      tipo ? [periodo, userId, tipo] : [periodo, userId],
    );

    step('reglas de período por tipo');
    await insert(null, periodId);
    await insert('DOCENTES', null);
    await expectCheck(() => insert('DOCENTES', periodId), 'Se aceptó una importación de docentes asociada a un período.');
    await expectCheck(() => insert('ESTUDIANTES', null), 'Se aceptó una importación de estudiantes sin período.');
    await expectCheck(() => insert(null, null), 'El tipo por defecto (ESTUDIANTES) aceptó una preparación sin período.');
    await db.query(`INSERT INTO ${s}."lote_importacion" ("periodo_id","ejecutado_por_id","tipo","nombre_archivo","ruta_almacenamiento","estado","total_filas","filas_ok","filas_error","fecha_inicio") VALUES (NULL,$1,'DOCENTES','a.xlsx','clave','EN_PROCESO',1,0,0,now())`, [userId]);

    step('reversión protegida');
    let protectedDown = false;
    try { await db.undoLastMigration({ transaction: 'all' }); }
    catch (error: unknown) { protectedDown = error instanceof Error && error.message.includes('importación de docentes'); }
    if (!protectedDown) throw new Error('La reversión no protegió las preparaciones de docentes.');

    step('reversión sin historial de docentes');
    await db.query(`DELETE FROM ${s}."preparacion_importacion" WHERE "tipo" = 'DOCENTES'`);
    await db.undoLastMigration({ transaction: 'all' });
    const rows = await db.query(`SELECT is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'preparacion_importacion' AND column_name IN ('periodo_id','tipo') ORDER BY column_name`, [schema]) as Array<{ is_nullable: string }>;
    if (rows.length !== 1 || rows[0].is_nullable !== 'NO') throw new Error('La reversión no restauró periodo_id obligatorio ni eliminó tipo.');
  },
});
