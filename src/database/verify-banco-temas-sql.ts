import { AcademicoService } from '../academico/academico.service.js';
import { AsignacionTemaPersistenciaService } from '../asignaciones-tema/asignacion-tema-persistencia.service.js';
import { AsignacionTutorPersistenciaService } from '../asignaciones-tutor/asignacion-tutor-persistencia.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { ConflictosService } from '../conflictos/conflictos.service.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { ExportacionTipo } from '../exportaciones/enums/exportacion-tipo.enum.js';
import { EstudianteHabilitado } from '../habilitados/entities/estudiante-habilitado.entity.js';
import { PreparacionImportacion } from '../importaciones/entities/preparacion-importacion.entity.js';
import { PreparacionImportacionEstado as EstadoPreparacion } from '../importaciones/enums/preparacion-importacion-estado.enum.js';
import { LoteImportacionTipo } from '../importaciones/enums/lote-importacion-tipo.enum.js';
import { ImportacionesTemasService } from '../importaciones/importaciones-temas.service.js';
import { NotificacionesPersistenciaService } from '../notificaciones/notificaciones-persistencia.service.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { ResumenPeriodoService } from '../periodos/resumen-periodo.service.js';
import { ReportesService } from '../reportes/reportes.service.js';
import { TemaHistorial } from '../temas/entities/tema-historial.entity.js';
import { Tema } from '../temas/entities/tema.entity.js';
import { TipoTema } from '../temas/enums/tipo-tema.enum.js';
import { TemasService } from '../temas/temas.service.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { catalogoSembrado } from './verify-academico.js';
import { QueryFailedError } from 'typeorm';
import { runTemporarySchemaVerification, type TemporarySchemaContext } from './verify-temp-schema.js';

/**
 * Executes (not mocks) the raw SQL introduced by the topic bank against PostgreSQL: period summary,
 * conflicts listing/detail, TEMAS_* reports, topic availability, the archived-period rules of the topic
 * lifecycle, the cross-period rejection on assignment and the topic import confirmation.
 */
await runTemporarySchemaVerification({
  prefix: 'test_banco_sql',
  subject: 'del SQL del banco de temas',
  cleanupSubject: 'del SQL del banco de temas',
  success: 'SQL del banco de temas (resumen, conflictos, reportes TEMAS_*, disponibilidad, períodos archivados, asignación entre períodos e importación) verificado en esquema temporal.',
  withEntities: true,
  async verify(context) {
    // Surface the PostgreSQL message and constraint instead of only the SQLSTATE.
    try { await verifyBancoTemasSql(context); }
    catch (error: unknown) {
      if (!(error instanceof QueryFailedError)) throw error;
      const driver = error.driverError as { code?: string; constraint?: string; message?: string };
      throw new Error(`PostgreSQL ${driver.code ?? 'desconocido'}${driver.constraint ? ` (${driver.constraint})` : ''}: ${driver.message ?? error.message}`, { cause: error });
    }
  },
});

async function verifyBancoTemasSql({ db, schemaSql: s, step }: TemporarySchemaContext): Promise<void> {
    step('fixtures');
    const { carreraId, facultadId } = await catalogoSembrado(db, s);
    const insertOne = async (sql: string, params: unknown[] = []): Promise<string> => ((await db.query(sql, params)) as Array<{ id: string }>)[0]!.id;
    const adminId = await insertOne(`INSERT INTO ${s}."usuario" ("email","nombres","apellidos","rol","estado") VALUES ('admin.sql@uleam.edu.ec','Admin','Sql','ADMIN','ACTIVO') RETURNING "id"`);
    const docenteUserId = await insertOne(`INSERT INTO ${s}."usuario" ("email","nombres","apellidos","rol","estado") VALUES ('docente.sql@uleam.edu.ec','Docente','Sql','DOCENTE','ACTIVO') RETURNING "id"`);
    const docenteId = await insertOne(`INSERT INTO ${s}."docente" ("usuario_id","carrera_id") VALUES ($1,$2) RETURNING "id"`, [docenteUserId, carreraId]);
    const lineaId = await insertOne(`INSERT INTO ${s}."linea_investigacion" ("codigo","nombre") VALUES ('SQL','Línea SQL') RETURNING "id"`);
    const periodo = async (codigo: string, estado: string): Promise<string> => {
      const initial = estado === 'ARCHIVADO' ? 'POSTULACION_CERRADA' : estado;
      const id = await insertOne(
        `INSERT INTO ${s}."periodo_titulacion" ("codigo","nombre","fecha_inicio_postulacion","fecha_fin_postulacion","fecha_inicio_titulacion","estado","max_integrantes_default","facultad_id") VALUES ($1,$1,now()-interval '3 days',now()+interval '2 days',now()+interval '3 days',$2,4,$3) RETURNING "id"`,
        [codigo, initial, facultadId],
      );
      if (estado !== initial) await db.query(`UPDATE ${s}."periodo_titulacion" SET "estado"=$2 WHERE "id"=$1`, [id, estado]);
      return id;
    };
    const periodoA = await periodo('SQL-A', 'POSTULACION_CERRADA');
    const periodoB = await periodo('SQL-B', 'POSTULACION_ABIERTA');
    const periodoC = await periodo('SQL-C', 'POSTULACION_CERRADA');
    const tema = async (titulo: string, tipo: string): Promise<string> => {
      const id = await insertOne(
        `INSERT INTO ${s}."tema" ("carrera_id","linea_id","docente_proponente_id","titulo","descripcion","tipo","estado") VALUES ($1,$2,$3,$4,'Descripción',$5,'PUBLICADO') RETURNING "id"`,
        [carreraId, lineaId, docenteId, titulo, tipo],
      );
      await db.query(`INSERT INTO ${s}."tema_historial" ("tema_id","usuario_id","estado_anterior","estado_nuevo","cambios") VALUES ($1,$2,NULL,'PUBLICADO','{}'::jsonb)`, [id, adminId]);
      return id;
    };
    const temaConPostulaciones = await tema('Tema con postulaciones', 'INDIVIDUAL');
    const temaSinPostulaciones = await tema('Tema sin postulaciones', 'INDIVIDUAL');
    const temaArchivado = await tema('Tema con postulación archivada', 'INDIVIDUAL');
    let n = 0;
    const estudiante = async (): Promise<{ id: string; usuarioId: string }> => {
      n += 1;
      const usuarioId = await insertOne(`INSERT INTO ${s}."usuario" ("email","nombres","apellidos","rol","estado") VALUES ($1,'Est','Sql','ESTUDIANTE','ACTIVO') RETURNING "id"`, [`est.sql${n}@live.uleam.edu.ec`]);
      const id = await insertOne(`INSERT INTO ${s}."estudiante" ("usuario_id","cedula","matricula","carrera_id","nivel") VALUES ($1,$2,$3,$4,8) RETURNING "id"`, [usuarioId, `01020304${String(n).padStart(2, '0')}`, `SQL-${n}`, carreraId]);
      for (const p of [periodoA, periodoB, periodoC]) {
        await db.query(`INSERT INTO ${s}."estudiante_habilitado" ("periodo_id","estudiante_id","origen","estado","condicion_ingreso","requisito_pendiente","situacion_ingreso") VALUES ($1,$2,'MANUAL','HABILITADO','CONDICIONADO','Pendiente','PENDIENTE')`, [p, id]);
      }
      return { id, usuarioId };
    };
    // Applications are seeded directly (the registration window and enablement rules are covered elsewhere).
    const postulacion = async (temaId: string, periodoId: string): Promise<string> => {
      const est = await estudiante();
      await db.query(`ALTER TABLE ${s}."postulacion" DISABLE TRIGGER USER`);
      try {
        return await insertOne(`INSERT INTO ${s}."postulacion" ("tema_id","periodo_id","estudiante_id","num_integrantes","registrada_por_id","estado") VALUES ($1,$2,$3,1,$4,'PENDIENTE') RETURNING "id"`, [temaId, periodoId, est.id, est.usuarioId]);
      } finally { await db.query(`ALTER TABLE ${s}."postulacion" ENABLE TRIGGER USER`); }
    };
    const postA = await postulacion(temaConPostulaciones, periodoA);
    const postA2 = await postulacion(temaConPostulaciones, periodoA);
    const postB = await postulacion(temaConPostulaciones, periodoB);
    const postC = await postulacion(temaConPostulaciones, periodoC);
    const postArchivada = await postulacion(temaArchivado, periodoC);
    await db.query(`UPDATE ${s}."periodo_titulacion" SET "estado"='ARCHIVADO' WHERE "id"=$1`, [periodoC]);
    const actor = await db.getRepository(Usuario).findOneByOrFail({ id: adminId });
    const audit = new AuditoriaService();
    const notificaciones = new NotificacionesPersistenciaService(db);
    const conflictos = new ConflictosService(db, audit);

    step('resumen del período (temas_por_estado)');
    const resumen = await new ResumenPeriodoService(db, conflictos).obtener(periodoA);
    if (resumen.temas_por_estado.PUBLICADO !== 1) throw new Error(`temas_por_estado inesperado: ${JSON.stringify(resumen.temas_por_estado)}.`);
    const resumenC = await new ResumenPeriodoService(db, conflictos).obtener(periodoC);
    if (resumenC.temas_por_estado.PUBLICADO !== 2) throw new Error(`temas_por_estado del período archivado inesperado: ${JSON.stringify(resumenC.temas_por_estado)}.`);

    step('conflictos (listado y detalle)');
    const listado = await conflictos.list(periodoA, { page: 1, limit: 20 } as never) as unknown as { data: Array<{ tema_id: string }> };
    const ids = listado.data.map((item) => item.tema_id);
    if (!ids.includes(temaConPostulaciones) || ids.includes(temaSinPostulaciones)) throw new Error(`Listado de conflictos inesperado: ${JSON.stringify(ids)}.`);
    const detalle = await conflictos.detail(periodoA, temaConPostulaciones);
    if (detalle.elegibles !== 2 || await conflictos.contarSinResolver(periodoA) !== 1) throw new Error('Detalle o conteo de conflictos inesperado.');

    step('reportes TEMAS_*');
    const reportes = new ReportesService(db);
    for (const tipo of [ExportacionTipo.TEMAS_OFERTADOS, ExportacionTipo.TEMAS_DISPONIBLES]) {
      const datos = await reportes.generar(db.manager, periodoA, tipo, {});
      if (datos.filas.length !== 3 || !datos.columnas.includes('Tipo')) throw new Error(`Reporte ${tipo} inesperado: ${datos.filas.length} filas.`);
    }

    step('disponibilidad (postulaciones abiertas sin períodos archivados)');
    const temas = new TemasService(
      db.getRepository(Tema), db.getRepository(TemaHistorial), db.getRepository(Docente), db.getRepository(Estudiante),
      db.getRepository(EstudianteHabilitado), db.getRepository(PeriodoTitulacion), db, audit, notificaciones, new AcademicoService(),
    );
    const catalogo = await temas.list({ page: 1, limit: 20 } as never, actor);
    const abiertas = (id: string): number | undefined => catalogo.data.find((item) => item.id === id)?.postulaciones_abiertas;
    if (abiertas(temaConPostulaciones) !== 3 || abiertas(temaArchivado) !== 0) throw new Error(`postulaciones_abiertas inesperado: ${abiertas(temaConPostulaciones)}, ${abiertas(temaArchivado)}.`);
    const enPeriodo = await temas.getById(temaConPostulaciones, { periodo_id: periodoB } as never, actor);
    if (enPeriodo.postulaciones_abiertas !== 1 || enPeriodo.disponible !== true) throw new Error('Disponibilidad por período inesperada.');

    step('edición y cierre con postulación de período archivado');
    await temas.update(temaArchivado, { tipo: TipoTema.PAREJA } as never, actor, null);
    await temas.close(temaArchivado, { motivo: 'Cierre de verificación' }, actor, null);
    const archivada = await db.query(`SELECT "estado"::text AS estado FROM ${s}."postulacion" WHERE "id"=$1`, [postArchivada]) as Array<{ estado: string }>;
    if (archivada[0]?.estado !== 'PENDIENTE') throw new Error('El cierre modificó una postulación de un período archivado.');

    step('asignación: rechazo de postulaciones de otros períodos');
    const persistencia = new AsignacionTemaPersistenciaService(audit, new AsignacionTutorPersistenciaService(audit), notificaciones);
    await db.transaction((manager) => persistencia.rechazarAbiertasDeOtrosPeriodos(manager, temaConPostulaciones, periodoA, 'Acta de verificación', actor, null));
    const estados = new Map((await db.query(`SELECT "id","estado"::text AS estado FROM ${s}."postulacion" WHERE "id" = ANY($1::uuid[])`, [[postA, postA2, postB, postC]]) as Array<{ id: string; estado: string }>).map((row) => [row.id, row.estado]));
    if (estados.get(postA) !== 'PENDIENTE' || estados.get(postA2) !== 'PENDIENTE' || estados.get(postB) !== 'RECHAZADA' || estados.get(postC) !== 'PENDIENTE') throw new Error(`Estados tras la asignación inesperados: ${JSON.stringify([...estados])}.`);
    const auditoria = await db.query(`SELECT count(*)::int AS total FROM ${s}."auditoria" WHERE "accion"='RECHAZAR_POSTULACION_POR_ASIGNACION_TEMA' AND "entidad_id"=$1`, [postB]) as Array<{ total: number }>;
    const avisos = await db.query(`SELECT count(*)::int AS total FROM ${s}."notificacion" WHERE "tipo"='POSTULACION_RECHAZADA' AND "entidad_id"=$1`, [postB]) as Array<{ total: number }>;
    if (Number(auditoria[0]?.total) !== 1 || Number(avisos[0]?.total) < 1) throw new Error('La asignación no registró auditoría o aviso del rechazo entre períodos.');

    step('confirmación de importación de temas');
    const docente = await db.getRepository(Docente).findOneOrFail({ where: { id: docenteId }, relations: { usuario: true } });
    const fila = (numero: number, titulo: string) => ({
      fila: numero, nro: String(numero), docente_excel: 'DOCENTE SQL', titulo, descripcion: null,
      docente: { id: docente.id, nombres: docente.usuario.nombres, apellidos: docente.usuario.apellidos }, candidatos: [], estado: 'LISTA', errores: [], advertencias: [],
    });
    const preparaciones = db.getRepository(PreparacionImportacion);
    const preparacion = await preparaciones.save(preparaciones.create({
      periodo: null, tipo: LoteImportacionTipo.TEMAS, carrera_id: carreraId, solicitada_por: actor, lote: null,
      nombre_archivo: 'temas.xlsx', ruta_almacenamiento: 'verificacion/temas.xlsx', sha256: 'a'.repeat(64), estado: EstadoPreparacion.LISTA,
      total_filas: 2, filas: { linea_id: lineaId, tipo: TipoTema.GRUPO, filas: [fila(2, 'Tema importado'), fila(3, 'Tema sin postulaciones')] },
      errores: null, ip_origen: null, expira_en: new Date(Date.now() + 60_000),
    } as never));
    const importacion = new ImportacionesTemasService(db, {} as never, audit, new AcademicoService());
    const confirmacion = await importacion.confirmar((preparacion as unknown as { id: string }).id, actor, null);
    if (confirmacion.creados !== 1 || confirmacion.omitidos !== 1) throw new Error(`Confirmación inesperada: ${JSON.stringify(confirmacion)}.`);
    const importados = await db.query(`SELECT count(*)::int AS total FROM ${s}."tema" WHERE "lote_importacion_id"=$1 AND "estado"='PUBLICADO' AND "tipo"='GRUPO'`, [confirmacion.lote_id]) as Array<{ total: number }>;
    if (Number(importados[0]?.total) !== 1) throw new Error('La importación no creó el tema PUBLICADO del lote.');
}
