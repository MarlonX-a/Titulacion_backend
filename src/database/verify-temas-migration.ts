import { catalogoSembrado } from './verify-academico.js';
import { pgErrorCode as code, runTemporarySchemaVerification } from './verify-temp-schema.js';

const FKS_NUEVAS = ['FK_postulacion_tema', 'FK_resolucion_conflicto_tema', 'FK_asignacion_tema_tema', 'FK_tema_lote_importacion'];
const FKS_ANTERIORES = ['FK_postulacion_tema_periodo', 'FK_resolucion_conflicto_tema_periodo', 'FK_asignacion_tema_tema_periodo', 'FK_tema_periodo'];

await runTemporarySchemaVerification({
  prefix: 'test_banco_temas',
  subject: 'del banco de temas',
  cleanupSubject: 'del banco de temas',
  success: 'Migración del banco de temas (tipo, temas sin período, claves foráneas, triggers por tipo, importación TEMAS y reversión protegida) verificada en esquema temporal.',
  async verify({ db, schema, schemaSql: s, step }) {
    step('columnas del banco');
    const columnas = await db.query(
      `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'tema' AND column_name = ANY($2::text[])`,
      [schema, ['tipo', 'lote_importacion_id', 'periodo_id', 'min_integrantes', 'max_integrantes']],
    ) as Array<{ column_name: string; is_nullable: string }>;
    const nullable = new Map(columnas.map((c) => [c.column_name, c.is_nullable]));
    if (nullable.size !== 2 || nullable.get('tipo') !== 'NO' || nullable.get('lote_importacion_id') !== 'YES') {
      throw new Error('tema debe tener tipo NOT NULL y lote_importacion_id opcional, sin periodo_id ni límites de integrantes.');
    }

    step('claves foráneas');
    const fks = await db.query(
      `SELECT constraint_name FROM information_schema.table_constraints WHERE table_schema = $1 AND constraint_type = 'FOREIGN KEY' AND constraint_name = ANY($2::text[])`,
      [schema, [...FKS_NUEVAS, ...FKS_ANTERIORES]],
    ) as Array<{ constraint_name: string }>;
    const nombres = fks.map((fk) => fk.constraint_name).sort();
    if (JSON.stringify(nombres) !== JSON.stringify([...FKS_NUEVAS].sort())) throw new Error(`Claves foráneas inesperadas: ${nombres.join(', ')}.`);

    step('importación TEMAS');
    const valores = await db.query(`SELECT unnest(enum_range(NULL::${s}."lote_importacion_tipo_enum"))::text AS valor`) as Array<{ valor: string }>;
    if (!valores.some((v) => v.valor === 'TEMAS')) throw new Error('lote_importacion_tipo_enum no incluye TEMAS.');
    const check = await db.query(
      `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = $1 AND c.conname = 'CHK_preparacion_importacion_periodo_tipo'`,
      [schema],
    ) as Array<{ def: string }>;
    if (!check[0]?.def.includes('TEMAS')) throw new Error('La preparación de importación no admite TEMAS sin período.');

    step('triggers por tipo');
    const funciones = await db.query(
      `SELECT p.proname, pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = $1 AND p.proname = ANY($2::text[])`,
      [schema, ['validar_postulacion_y_bloquear_periodo', 'proteger_asignacion_tema']],
    ) as Array<{ proname: string; def: string }>;
    if (funciones.length !== 2 || funciones.some((f) => !f.def.includes('"tipo"') || f.def.includes('AND "periodo_id"=NEW."periodo_id" FOR UPDATE') || f.def.includes('t."periodo_id"=NEW."periodo_id" FOR UPDATE'))) {
      throw new Error('Los triggers de postulación y asignación no derivan el rango del tipo del tema.');
    }
    const archivado = await db.query(
      `SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = 'tema' AND tg.tgname = 'TRG_tema_bloquear_periodo_archivado'`,
      [schema],
    ) as unknown[];
    if (archivado.length !== 0) throw new Error('tema conserva el trigger de período archivado.');

    step('tema sin período');
    const { carreraId } = await catalogoSembrado(db, s);
    const [usuario] = await db.query(`INSERT INTO ${s}."usuario" ("email","nombres","apellidos","rol","estado") VALUES ('docente.banco@uleam.edu.ec','Docente','Banco','DOCENTE','ACTIVO') RETURNING "id"`) as Array<{ id: string }>;
    const [docente] = await db.query(`INSERT INTO ${s}."docente" ("usuario_id","carrera_id") VALUES ($1,$2) RETURNING "id"`, [usuario!.id, carreraId]) as Array<{ id: string }>;
    const [linea] = await db.query(`INSERT INTO ${s}."linea_investigacion" ("codigo","nombre") VALUES ('BANCO','Banco de temas') RETURNING "id"`) as Array<{ id: string }>;
    await db.query(
      `INSERT INTO ${s}."tema" ("carrera_id","linea_id","docente_proponente_id","titulo","descripcion","tipo") VALUES ($1,$2,$3,'Tema del banco','Descripción del banco','GRUPO')`,
      [carreraId, linea!.id, docente!.id],
    );
    let tipoInvalido = false;
    try {
      await db.query(`INSERT INTO ${s}."tema" ("carrera_id","linea_id","docente_proponente_id","titulo","descripcion","tipo") VALUES ($1,$2,$3,'Tipo inválido','Descripción','TRIO')`, [carreraId, linea!.id, docente!.id]);
    } catch (error: unknown) { tipoInvalido = code(error) === '22P02'; }
    if (!tipoInvalido) throw new Error('PostgreSQL aceptó un tipo de tema desconocido.');

    step('reversión protegida');
    let protegida = false;
    try { await db.undoLastMigration({ transaction: 'all' }); }
    catch (error: unknown) { protegida = error instanceof Error && error.message.includes('no tienen una asignación'); }
    if (!protegida) throw new Error('La reversión no protegió los temas sin asignación.');

    step('reversión sin datos');
    await db.query(`DELETE FROM ${s}."tema"`);
    await db.undoLastMigration({ transaction: 'all' });
    const restaurado = await db.query(
      `SELECT (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'tema' AND column_name IN ('periodo_id','min_integrantes','max_integrantes')) AS columnas, (SELECT count(*)::int FROM unnest(enum_range(NULL::${s}."lote_importacion_tipo_enum")) v WHERE v::text = 'TEMAS') AS temas`,
      [schema],
    ) as Array<{ columnas: number; temas: number }>;
    if (Number(restaurado[0]?.columnas) !== 3 || Number(restaurado[0]?.temas) !== 0) throw new Error('La reversión no restauró el modelo por período.');
  },
});
