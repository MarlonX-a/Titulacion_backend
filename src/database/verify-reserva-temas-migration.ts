import { QueryFailedError } from 'typeorm';
import { AcademicoService } from '../academico/academico.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { EstudianteHabilitado } from '../habilitados/entities/estudiante-habilitado.entity.js';
import { NotificacionesPersistenciaService } from '../notificaciones/notificaciones-persistencia.service.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { ConfirmacionesPostulacionService } from '../postulaciones/confirmaciones-postulacion.service.js';
import { ReservaTemaService } from '../postulaciones/reserva-tema.service.js';
import { TemaHistorial } from '../temas/entities/tema-historial.entity.js';
import { Tema } from '../temas/entities/tema.entity.js';
import { TemasService } from '../temas/temas.service.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { catalogoSembrado } from './verify-academico.js';
import { pgErrorCode as code, runTemporarySchemaVerification, undoMigrationsThrough, type TemporarySchemaContext } from './verify-temp-schema.js';

const MIGRACION = 'ReservaTemaConfirmacion20261115100000';

/**
 * Verifies migration 20261115100000 (topic reservation + mandatory confirmation) and the SQL of the
 * reservation services against PostgreSQL. Also runs the topic list with a facultad filter on
 * two seeded facultades (review fix of the facultad filter).
 */
await runTemporarySchemaVerification({
  prefix: 'test_reserva',
  subject: 'de la reserva de temas',
  cleanupSubject: 'de la reserva de temas',
  success: 'Reserva de temas (enums, índice de exclusividad, disparadores, confirmaciones, vencimiento, liberación, filtro por facultad y reversión protegida) verificada en esquema temporal.',
  withEntities: true,
  async verify(context) {
    try { await verificar(context); }
    catch (error: unknown) {
      if (!(error instanceof QueryFailedError)) throw error;
      const driver = error.driverError as { code?: string; constraint?: string; message?: string };
      throw new Error(`PostgreSQL ${driver.code ?? 'desconocido'}${driver.constraint ? ` (${driver.constraint})` : ''}: ${driver.message ?? error.message}`, { cause: error });
    }
  },
});

async function falla(promesa: Promise<unknown>, esperado: string): Promise<boolean> {
  try { await promesa; return false; } catch (error: unknown) { return code(error) === esperado; }
}

async function verificar({ db, schema, schemaSql: s, step }: TemporarySchemaContext): Promise<void> {
  step('reversión sin datos y reaplicación');
  await undoMigrationsThrough(db, s, MIGRACION);
  const sinTabla = await db.query(`SELECT to_regclass($1) AS tabla`, [`${schema}.postulacion_confirmacion`]) as Array<{ tabla: string | null }>;
  if (sinTabla[0]?.tabla !== null) throw new Error('La reversión no eliminó postulacion_confirmacion.');
  await db.runMigrations({ transaction: 'all' });

  step('enums e índice de exclusividad');
  const valores = await db.query(`SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS valores FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND t.typname IN ('tema_estado_enum','postulacion_estado_enum','postulacion_confirmacion_estado_enum') GROUP BY t.typname`, [schema]) as Array<{ typname: string; valores: string[] }>;
  const enumDe = (nombre: string) => valores.find((row) => row.typname === nombre)?.valores ?? [];
  if (!enumDe('tema_estado_enum').includes('RESERVADO') || !enumDe('postulacion_estado_enum').includes('PENDIENTE_CONFIRMACION') || enumDe('postulacion_confirmacion_estado_enum').join() !== 'PENDIENTE,CONFIRMADA,RECHAZADA') {
    throw new Error(`Valores de enum inesperados: ${JSON.stringify(valores)}.`);
  }
  const indice = await db.query(`SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname='UQ_postulacion_reserva_tema'`, [schema]) as Array<{ indexdef: string }>;
  if (!indice[0]?.indexdef.includes('PENDIENTE_CONFIRMACION') || !indice[0].indexdef.includes('fecha_postulacion')) throw new Error('Falta el índice de exclusividad de la reserva.');

  step('fixtures');
  const { carreraId, facultadId } = await catalogoSembrado(db, s);
  const otra = await catalogoSembrado(db, s, 'DERECHO').catch(async () => {
    const rows = await db.query(`SELECT c."id", c."facultad_id" FROM ${s}."carrera" c WHERE c."facultad_id" <> $1 ORDER BY c."codigo" LIMIT 1`, [facultadId]) as Array<{ id: string; facultad_id: string }>;
    return { carreraId: rows[0]!.id, facultadId: rows[0]!.facultad_id };
  });
  const uno = async (sql: string, params: unknown[] = []): Promise<string> => ((await db.query(sql, params)) as Array<{ id: string }>)[0]!.id;
  const adminId = await uno(`INSERT INTO ${s}."usuario" ("email","nombres","apellidos","rol","estado") VALUES ('admin.reserva@uleam.edu.ec','Admin','Reserva','ADMIN','ACTIVO') RETURNING "id"`);
  const docenteUser = await uno(`INSERT INTO ${s}."usuario" ("email","nombres","apellidos","rol","estado") VALUES ('docente.reserva@uleam.edu.ec','Docente','Reserva','DOCENTE','ACTIVO') RETURNING "id"`);
  const docenteId = await uno(`INSERT INTO ${s}."docente" ("usuario_id","carrera_id","habilitado_tutoria") VALUES ($1,$2,true) RETURNING "id"`, [docenteUser, carreraId]);
  const docenteOtraUser = await uno(`INSERT INTO ${s}."usuario" ("email","nombres","apellidos","rol","estado") VALUES ('docente.otra@uleam.edu.ec','Docente','Otra','DOCENTE','ACTIVO') RETURNING "id"`);
  const docenteOtraId = await uno(`INSERT INTO ${s}."docente" ("usuario_id","carrera_id") VALUES ($1,$2) RETURNING "id"`, [docenteOtraUser, otra.carreraId]);
  const lineaId = await uno(`INSERT INTO ${s}."linea_investigacion" ("codigo","nombre") VALUES ('RES','Línea reserva') RETURNING "id"`);
  const periodoId = await uno(`INSERT INTO ${s}."periodo_titulacion" ("codigo","nombre","fecha_inicio_postulacion","fecha_fin_postulacion","fecha_inicio_titulacion","estado","max_integrantes_default","facultad_id") VALUES ('RES','Reserva',now()-interval '3 days',now()+interval '2 days',now()+interval '3 days','POSTULACION_ABIERTA',4,$1) RETURNING "id"`, [facultadId]);
  const tema = (titulo: string, carrera = carreraId, docente = docenteId) => uno(`INSERT INTO ${s}."tema" ("carrera_id","linea_id","docente_proponente_id","titulo","descripcion","tipo","estado") VALUES ($1,$2,$3,$4,'Descripción','INDIVIDUAL','PUBLICADO') RETURNING "id"`, [carrera, lineaId, docente, titulo]);
  const temaA = await tema('Tema reservado');
  const temaB = await tema('Tema que vence');
  const temaOtraFacultad = await tema('Tema de otra facultad', otra.carreraId, docenteOtraId);
  let n = 0;
  const estudiante = async (): Promise<{ id: string; usuarioId: string }> => {
    n += 1;
    const usuarioId = await uno(`INSERT INTO ${s}."usuario" ("email","nombres","apellidos","rol","estado") VALUES ($1,'Est','Reserva','ESTUDIANTE','ACTIVO') RETURNING "id"`, [`est.res${n}@live.uleam.edu.ec`]);
    const id = await uno(`INSERT INTO ${s}."estudiante" ("usuario_id","cedula","matricula","carrera_id","nivel") VALUES ($1,$2,$3,$4,8) RETURNING "id"`, [usuarioId, `09080706${String(n).padStart(2, '0')}`, `RES-${n}`, carreraId]);
    await db.query(`INSERT INTO ${s}."estudiante_habilitado" ("periodo_id","estudiante_id","origen","estado","condicion_ingreso","requisito_pendiente","situacion_ingreso") VALUES ($1,$2,'MANUAL','HABILITADO','CONDICIONADO','Pendiente','PENDIENTE')`, [periodoId, id]);
    return { id, usuarioId };
  };
  const [e1, e2, e3] = [await estudiante(), await estudiante(), await estudiante()];
  /** Inserta una postulación individual con sus tutores en una transacción (los disparadores siguen activos). */
  const postular = (temaId: string, est: { id: string; usuarioId: string }, estado: string, fecha = 'now()') => db.transaction(async (m) => {
    const rows = await m.query(`INSERT INTO ${s}."postulacion" ("tema_id","periodo_id","estudiante_id","num_integrantes","registrada_por_id","estado","fecha_postulacion") VALUES ($1,$2,$3,1,$4,$5,${fecha}) RETURNING "id"`, [temaId, periodoId, est.id, est.usuarioId, estado]) as Array<{ id: string }>;
    await m.query(`INSERT INTO ${s}."tutor_propuesto" ("postulacion_id","docente_id","orden_prioridad") VALUES ($1,$2,1)`, [rows[0]!.id, docenteId]);
    return rows[0]!.id;
  });

  step('estado inicial de una postulación nueva');
  if (!await falla(postular(temaA, e1, 'ACEPTADA'), '23514')) throw new Error('Se insertó una postulación nueva en un estado distinto de PENDIENTE_CONFIRMACION/PENDIENTE.');

  step('exclusividad por tema');
  const p1 = await postular(temaA, e1, 'PENDIENTE_CONFIRMACION');
  if (!await falla(postular(temaA, e2, 'PENDIENTE'), '23505')) throw new Error('El índice permitió dos postulaciones vigentes al mismo tema.');

  step('transiciones de PENDIENTE_CONFIRMACION');
  if (!await falla(db.query(`UPDATE ${s}."postulacion" SET "estado"='RECHAZADA' WHERE "id"=$1`, [p1]), '23514')) throw new Error('Se rechazó sin observación.');
  await db.query(`UPDATE ${s}."postulacion" SET "estado"='PENDIENTE' WHERE "id"=$1`, [p1]);
  if (!await falla(db.query(`UPDATE ${s}."postulacion" SET "estado"='PENDIENTE_CONFIRMACION' WHERE "id"=$1`, [p1]), '23514')) throw new Error('Se permitió volver a PENDIENTE_CONFIRMACION.');

  step('confirmaciones protegidas');
  const c1 = await uno(`INSERT INTO ${s}."postulacion_confirmacion" ("postulacion_id","estudiante_id") VALUES ($1,$2) RETURNING "id"`, [p1, e1.id]);
  if (!await falla(db.query(`UPDATE ${s}."postulacion_confirmacion" SET "estado"='CONFIRMADA' WHERE "id"=$1`, [c1]), '23514')) throw new Error('Se confirmó sin fecha de respuesta.');
  await db.query(`UPDATE ${s}."postulacion_confirmacion" SET "estado"='CONFIRMADA',"respondida_en"=now() WHERE "id"=$1`, [c1]);
  if (!await falla(db.query(`UPDATE ${s}."postulacion_confirmacion" SET "estado"='RECHAZADA' WHERE "id"=$1`, [c1]), '23514')) throw new Error('Se cambió una confirmación ya respondida.');
  if (!await falla(db.query(`DELETE FROM ${s}."postulacion_confirmacion" WHERE "id"=$1`, [c1]), '23514')) throw new Error('Se eliminó una confirmación.');
  if (!await falla(db.query(`INSERT INTO ${s}."postulacion_confirmacion" ("postulacion_id","estudiante_id") VALUES ($1,$2)`, [p1, e1.id]), '23505')) throw new Error('Se duplicó la confirmación de un estudiante.');

  step('historial sin usuario solo automático');
  if (!await falla(db.query(`INSERT INTO ${s}."tema_historial" ("tema_id","usuario_id","estado_anterior","estado_nuevo","cambios") VALUES ($1,NULL,'PUBLICADO','RESERVADO','{}'::jsonb)`, [temaA]), '23514')) throw new Error('Se aceptó historial sin usuario ni marca automática.');

  step('asignación sobre un tema RESERVADO');
  await db.query(`UPDATE ${s}."tema" SET "estado"='RESERVADO' WHERE "id"=$1`, [temaA]);
  await db.query(`UPDATE ${s}."periodo_titulacion" SET "estado"='POSTULACION_CERRADA' WHERE "id"=$1`, [periodoId]);
  await db.transaction(async (m) => {
    await m.query(`UPDATE ${s}."postulacion" SET "estado"='ACEPTADA',"observacion"='Asignación de verificación' WHERE "id"=$1`, [p1]);
    await m.query(`INSERT INTO ${s}."asignacion_tema" ("tema_id","periodo_id","postulacion_id","estudiante_id","aprobada_por_id","motivo") VALUES ($1,$2,$3,$4,$5,'Acta')`, [temaA, periodoId, p1, e1.id, adminId]);
    await m.query(`UPDATE ${s}."tema" SET "estado"='ASIGNADO' WHERE "id"=$1`, [temaA]);
  });
  await db.query(`UPDATE ${s}."periodo_titulacion" SET "estado"='POSTULACION_ABIERTA' WHERE "id"=$1`, [periodoId]);

  step('vencimiento automático de una reserva de más de 48 horas');
  const audit = new AuditoriaService();
  const notificaciones = new NotificacionesPersistenciaService(db);
  const reservas = new ReservaTemaService(db, audit, notificaciones);
  const vencida = await postular(temaB, e2, 'PENDIENTE_CONFIRMACION', `now() - interval '49 hours'`);
  await db.query(`UPDATE ${s}."tema" SET "estado"='RESERVADO' WHERE "id"=$1`, [temaB]);
  const barrido = await reservas.expirarVencidas();
  const tras = await db.query(`SELECT (SELECT "estado"::text FROM ${s}."postulacion" WHERE "id"=$1) AS postulacion, (SELECT "estado"::text FROM ${s}."tema" WHERE "id"=$2) AS tema, (SELECT count(*)::int FROM ${s}."tema_historial" WHERE "tema_id"=$2 AND "usuario_id" IS NULL AND ("cambios"->>'automatico')='true') AS historial, (SELECT count(*)::int FROM ${s}."auditoria" WHERE "accion"='EXPIRAR_RESERVA_POSTULACION' AND "entidad_id"=$1 AND "usuario_id" IS NULL) AS auditoria`, [vencida, temaB]) as Array<{ postulacion: string; tema: string; historial: number; auditoria: number }>;
  if (barrido.expiradas !== 1 || tras[0]?.postulacion !== 'CANCELADA' || tras[0]?.tema !== 'PUBLICADO' || Number(tras[0]?.historial) !== 1 || Number(tras[0]?.auditoria) !== 1) {
    throw new Error(`Vencimiento inesperado: ${JSON.stringify({ barrido, tras: tras[0] })}.`);
  }

  step('confirmación y rechazo por el servicio');
  const confirmaciones = new ConfirmacionesPostulacionService(db, audit, notificaciones, reservas);
  const p3 = await postular(temaB, e3, 'PENDIENTE_CONFIRMACION');
  await db.query(`UPDATE ${s}."tema" SET "estado"='RESERVADO' WHERE "id"=$1`, [temaB]);
  await db.query(`INSERT INTO ${s}."postulacion_confirmacion" ("postulacion_id","estudiante_id") VALUES ($1,$2)`, [p3, e3.id]);
  const usuario3 = await db.getRepository(Usuario).findOneByOrFail({ id: e3.usuarioId });
  const pendientes = await confirmaciones.listarPendientes(usuario3);
  if (pendientes.length !== 1 || pendientes[0]?.postulacion_id !== p3) throw new Error('La lista de confirmaciones pendientes no incluye la reserva vigente.');
  const confirmada = await confirmaciones.confirmar(p3, usuario3, null);
  if (confirmada.estado_postulacion !== 'PENDIENTE' || confirmada.tema.estado !== 'RESERVADO') throw new Error(`Confirmación inesperada: ${JSON.stringify(confirmada)}.`);
  const repetida = await confirmaciones.confirmar(p3, usuario3, null);
  if (repetida.mi_confirmacion.estado !== 'CONFIRMADA') throw new Error('Confirmar dos veces no fue idempotente.');
  if ((await confirmaciones.listarPendientes(usuario3)).length !== 0) throw new Error('Una reserva confirmada sigue como pendiente.');

  step('cancelación libera el tema');
  await db.transaction(async (m) => {
    await m.query(`UPDATE ${s}."postulacion" SET "estado"='CANCELADA',"observacion"='Desistimiento' WHERE "id"=$1`, [p3]);
    await reservas.liberarSiCorresponde(m, temaB, { actor: usuario3, ip: null }, 'Desistimiento');
  });
  const temaLibre = await db.query(`SELECT "estado"::text AS estado FROM ${s}."tema" WHERE "id"=$1`, [temaB]) as Array<{ estado: string }>;
  if (temaLibre[0]?.estado !== 'PUBLICADO') throw new Error('La cancelación no liberó el tema.');

  step('filtro de temas por facultad (dos facultades)');
  const temas = new TemasService(db.getRepository(Tema), db.getRepository(TemaHistorial), db.getRepository(Docente), db.getRepository(Estudiante), db.getRepository(EstudianteHabilitado), db.getRepository(PeriodoTitulacion), db, audit, notificaciones, new AcademicoService());
  const admin = await db.getRepository(Usuario).findOneByOrFail({ id: adminId });
  const deFacultad = await temas.list({ page: 1, limit: 50, facultad_id: otra.facultadId } as never, admin);
  if (deFacultad.total !== 1 || deFacultad.data[0]?.id !== temaOtraFacultad) throw new Error(`El filtro por facultad devolvió ${JSON.stringify(deFacultad.data.map((t) => t.id))}.`);
  const cruzado = await temas.list({ page: 1, limit: 50, facultad_id: otra.facultadId, carrera_id: carreraId } as never, admin);
  if (cruzado.total !== 0) throw new Error('Carrera de otra facultad no devolvió una página vacía.');

  step('reversión protegida');
  let protegida = false;
  try { await undoMigrationsThrough(db, s, MIGRACION); }
  catch (error: unknown) { protegida = error instanceof Error && error.message.includes('No se puede revertir la reserva de temas'); }
  if (!protegida) throw new Error('La reversión no protegió las confirmaciones existentes.');
}
