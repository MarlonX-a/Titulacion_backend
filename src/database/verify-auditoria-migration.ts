import { AuditoriaConsultaService } from '../auditoria/auditoria-consulta.service.js';
import type { ListAuditoriaQueryDto } from '../auditoria/dto/list-auditoria-query.dto.js';
import type { DatabaseDataSource } from './database-data-source.js';
import { pgErrorCode as code, runTemporarySchemaVerification, undoMigrationsThrough } from './verify-temp-schema.js';

const page = (values: Partial<ListAuditoriaQueryDto>): ListAuditoriaQueryDto => ({ page: 1, limit: 20, ...values }) as ListAuditoriaQueryDto;

async function indexes(db: DatabaseDataSource, schema: string): Promise<string[]> {
  const rows = await db.query(`SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'auditoria' ORDER BY indexname`, [schema]) as Array<{ indexname: string }>;
  return rows.map((row) => row.indexname);
}

await runTemporarySchemaVerification({
  prefix: 'test_audit',
  subject: 'de auditoría',
  cleanupSubject: 'de auditoría',
  success: 'Índices, consulta e inmutabilidad de auditoría (filtros, orden, rango inclusivo, escape ILIKE, INSERT admitido, UPDATE/DELETE/TRUNCATE rechazados y reversión) verificados en esquema temporal.',
  async verify({ db, schema, schemaSql: s, step }) {
    step('índices creados');
    const present = await indexes(db, schema);
    if (!present.includes('IDX_auditoria_fecha_hora') || !present.includes('IDX_auditoria_usuario')) throw new Error('No se crearon los índices de consulta de auditoría.');

    step('consulta con filtros');
    const adminId = '00000000-0000-4000-8000-000000000001';
    const otherId = '00000000-0000-4000-8000-000000000002';
    const entity = '00000000-0000-4000-8000-0000000000aa';
    await db.query(`INSERT INTO ${s}."usuario" ("id","email","nombres","apellidos","rol","estado","id_externo_sso") VALUES ($1,'admin_x@uleam.edu.ec','Ada','Admin','ADMIN','ACTIVO',NULL),($2,'adminxx@uleam.edu.ec','Otro','Admin','ADMIN','ACTIVO',NULL)`, [adminId, otherId]);
    await db.query(`INSERT INTO ${s}."auditoria" ("usuario_id","accion","entidad_tipo","entidad_id","valores_anteriores","valores_nuevos","ip_origen","fecha_hora") VALUES
      ($1,'CREAR_TEMA','tema',$3,NULL,'{"titulo":"A"}','10.0.0.5','2026-10-01T10:00:00Z'),
      ($1,'EDITAR_TEMA','tema',$3,'{"titulo":"A"}','{"titulo":"B"}',NULL,'2026-10-02T10:00:00Z'),
      ($2,'CREAR_USUARIO','usuario',$3,NULL,'{"email":"x"}','10.0.0.6','2026-10-03T10:00:00Z')`, [adminId, otherId, entity]);
    const service = new AuditoriaConsultaService(db);
    const all = await service.listar(page({}));
    if (all.total !== 3 || all.data[0].accion !== 'CREAR_USUARIO' || typeof all.data[0].id !== 'string' || all.data[2].ip_origen !== '10.0.0.5') throw new Error('La consulta sin filtros no respetó orden, id textual o IP.');
    const literal = await service.listar(page({ q: 'admin_x' }));
    if (literal.total !== 2 || literal.data.some((row) => row.actor?.id !== adminId)) throw new Error('El texto libre no escapó el comodín _.');
    const range = await service.listar(page({ desde: '2026-10-02', hasta: '2026-10-02', entidad_tipo: 'tema' }));
    if (range.total !== 1 || range.data[0].accion !== 'EDITAR_TEMA') throw new Error('El rango de fechas inclusivo no filtró correctamente.');
    const byActor = await service.listar(page({ usuario_id: otherId, accion: 'CREAR_USUARIO', entidad_id: entity, limit: 1 }));
    if (byActor.total !== 1 || byActor.data[0].actor?.email !== 'adminxx@uleam.edu.ec') throw new Error('Los filtros exactos no funcionaron.');

    step('actor automático');
    await db.query(`INSERT INTO ${s}."auditoria" ("usuario_id","accion","entidad_tipo","entidad_id","valores_nuevos") VALUES (NULL,'CERRAR_POSTULACION','periodo_titulacion',$1,'{"automatico":true}')`, [entity]);
    let manualSinActor = false;
    try {
      await db.query(`INSERT INTO ${s}."auditoria" ("usuario_id","accion","entidad_tipo","entidad_id","valores_nuevos") VALUES (NULL,'EDITAR_TEMA','tema',$1,'{"titulo":"C"}')`, [entity]);
      manualSinActor = true;
    } catch (error: unknown) {
      if (code(error) !== '23514') throw error;
    }
    if (manualSinActor) throw new Error('Se aceptó una auditoría manual sin actor.');
    const automatica = await service.listar(page({ accion: 'CERRAR_POSTULACION' }));
    if (automatica.total !== 1 || automatica.data[0].actor !== null) throw new Error('La consulta no devolvió la auditoría automática sin actor.');

    step('inmutabilidad');
    const total = async () => Number((await db.query(`SELECT count(*)::int AS total FROM ${s}."auditoria"`) as Array<{ total: number }>)[0]?.total);
    const antes = await total();
    await db.query(`INSERT INTO ${s}."auditoria" ("usuario_id","accion","entidad_tipo","entidad_id","valores_nuevos") VALUES ($1,'LOGIN_EXITOSO','usuario',$1,'{"automatico":true}')`, [adminId]);
    if (await total() !== antes + 1) throw new Error('La auditoría no admitió un INSERT.');
    const rechazada = async (sql: string): Promise<boolean> => {
      try { await db.query(sql); return false; }
      catch (error: unknown) { if (code(error) !== '23514') throw error; return true; }
    };
    if (!await rechazada(`UPDATE ${s}."auditoria" SET "accion"='MANIPULADA' WHERE "usuario_id"='${adminId}'`)) throw new Error('Se aceptó un UPDATE sobre la auditoría.');
    if (!await rechazada(`UPDATE ${s}."auditoria" SET "valores_nuevos"='{"automatico":true}' WHERE "usuario_id" IS NULL`)) throw new Error('Se aceptó un UPDATE sobre una auditoría automática.');
    if (!await rechazada(`DELETE FROM ${s}."auditoria" WHERE "usuario_id" IS NULL`)) throw new Error('Se aceptó un DELETE sobre la auditoría.');
    if (!await rechazada(`TRUNCATE ${s}."auditoria"`)) throw new Error('Se aceptó un TRUNCATE sobre la auditoría.');
    if (await total() !== antes + 1) throw new Error('La auditoría cambió a pesar de los rechazos.');

    step('reversión');
    // Primero se retira la inmutabilidad; solo entonces se pueden borrar los registros automáticos
    // que impedirían revertir el actor automático.
    await undoMigrationsThrough(db, s, 'AuditoriaInmutable20261111100000');
    await db.query(`DELETE FROM ${s}."auditoria" WHERE "usuario_id" IS NULL`);
    await undoMigrationsThrough(db, s, 'IndicesConsultaAuditoria20261027100000');
    const after = await indexes(db, schema);
    if (after.includes('IDX_auditoria_fecha_hora') || after.includes('IDX_auditoria_usuario') || !after.includes('IDX_auditoria_entidad')) throw new Error('La reversión no eliminó solo los índices nuevos.');
  },
});
