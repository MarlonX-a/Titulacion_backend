import { createHash, randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryFailedError } from 'typeorm';
import { Auditoria } from '../auditoria/entities/auditoria.entity.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { AsignacionTemaPersistenciaService } from '../asignaciones-tema/asignacion-tema-persistencia.service.js';
import { AsignacionTutorPersistenciaService } from '../asignaciones-tutor/asignacion-tutor-persistencia.service.js';
import { AsignacionesTutorService } from '../asignaciones-tutor/asignaciones-tutor.service.js';
import { AsignacionTutor } from '../asignaciones-tutor/entities/asignacion-tutor.entity.js';
import { AsignacionTutorTipo } from '../asignaciones-tutor/enums/asignacion-tutor-tipo.enum.js';
import { AsignacionTutorEstado } from '../asignaciones-tutor/enums/asignacion-tutor-estado.enum.js';
import { CargaTutorialPersistenciaService } from '../carga-tutorial/carga-tutorial-persistencia.service.js';
import { ConfigCargaTutorial } from '../carga-tutorial/entities/config-carga-tutorial.entity.js';
import { CreateCargaTutorial20261007100000 } from './migrations/20261007100000-CreateCargaTutorial.js';
import { CreateAsignacionesTutor20261008100000 } from './migrations/20261008100000-CreateAsignacionesTutor.js';
import { CreatePlantillasPat20261009100000 } from './migrations/20261009100000-CreatePlantillasPat.js';
import { CreateDocumentosPat20261010100000 } from './migrations/20261010100000-CreateDocumentosPat.js';
import { AlignDocumentosPatLockOrder20261011100000 } from './migrations/20261011100000-AlignDocumentosPatLockOrder.js';
import { CreateRevisionesPat20261012100000 } from './migrations/20261012100000-CreateRevisionesPat.js';
import { RevisionPat } from '../revisiones-pat/entities/revision-pat.entity.js';
import { RevisionPatResultado } from '../revisiones-pat/enums/revision-pat-resultado.enum.js';
import { RevisionesPatService } from '../revisiones-pat/revisiones-pat.service.js';
import { PlantillaPat } from '../plantillas-pat/entities/plantilla-pat.entity.js';
import { DocumentoPat } from '../documentos-pat/entities/documento-pat.entity.js';
import { DocumentoPatFormato } from '../documentos-pat/enums/documento-pat-formato.enum.js';
import { AsignacionTema } from '../asignaciones-tema/entities/asignacion-tema.entity.js';
import { AsignacionesTemaService } from '../asignaciones-tema/asignaciones-tema.service.js';
import { AsignacionTemaEstado } from '../asignaciones-tema/enums/asignacion-tema-estado.enum.js';
import { HabilitadosService } from '../habilitados/habilitados.service.js';
import { EstudiantesService } from '../estudiantes/estudiantes.service.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { Grupo } from '../grupos/entities/grupo.entity.js';
import { GrupoIntegrante } from '../grupos/entities/grupo-integrante.entity.js';
import { GrupoEstado } from '../grupos/enums/grupo-estado.enum.js';
import { GrupoIntegranteEstado } from '../grupos/enums/grupo-integrante-estado.enum.js';
import { GrupoIntegranteRol } from '../grupos/enums/grupo-integrante-rol.enum.js';
import { EstudianteHabilitado } from '../habilitados/entities/estudiante-habilitado.entity.js';
import { CondicionIngreso } from '../habilitados/enums/condicion-ingreso.enum.js';
import { HabilitadoEstado } from '../habilitados/enums/habilitado-estado.enum.js';
import { HabilitadoOrigen } from '../habilitados/enums/habilitado-origen.enum.js';
import { SituacionIngreso } from '../habilitados/enums/situacion-ingreso.enum.js';
import { LineaInvestigacion } from '../lineas-investigacion/entities/linea-investigacion.entity.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodosService } from '../periodos/periodos.service.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { Tema } from '../temas/entities/tema.entity.js';
import { EstadoTema } from '../temas/enums/estado-tema.enum.js';
import { Postulacion } from '../postulaciones/entities/postulacion.entity.js';
import { TutorPropuesto } from '../postulaciones/entities/tutor-propuesto.entity.js';
import { EstadoPostulacion } from '../postulaciones/enums/estado-postulacion.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { ConflictosService } from '../conflictos/conflictos.service.js';
import { CriterioConflicto } from '../conflictos/enums/criterio-conflicto.enum.js';
import { CreateConflictos20261002100000 } from './migrations/20261002100000-CreateConflictos.js';
import { CreateUsuario20261002000000 } from './migrations/20261002000000-CreateUsuario.js';
import { CreateEstudianteDocente20261002010000 } from './migrations/20261002010000-CreateEstudianteDocente.js';
import { CreatePeriodoTitulacion20261002020000 } from './migrations/20261002020000-CreatePeriodoTitulacion.js';
import { CreateHabilitados20261002030000 } from './migrations/20261002030000-CreateHabilitados.js';
import { CreateLineaInvestigacion20261002040000 } from './migrations/20261002040000-CreateLineaInvestigacion.js';
import { CreateTemas20261002050000 } from './migrations/20261002050000-CreateTemas.js';
import { CreateGruposInvitaciones20261002060000 } from './migrations/20261002060000-CreateGruposInvitaciones.js';
import { GroupIntegrityLifecycle20261002070000 } from './migrations/20261002070000-GroupIntegrityLifecycle.js';
import { CreatePostulaciones20261002080000 } from './migrations/20261002080000-CreatePostulaciones.js';
import { CreateTutoresPropuestos20261002090000 } from './migrations/20261002090000-CreateTutoresPropuestos.js';
import { CreateAsignacionesTema20261002110000 } from './migrations/20261002110000-CreateAsignacionesTema.js';
import { StrengthenAsignacionTemaIntegrity20261002120000 } from './migrations/20261002120000-StrengthenAsignacionTemaIntegrity.js';
import { loadEnvironment } from '../config/load-environment.js';
import { createDatabaseOptions } from './database.options.js';
import { DatabaseDataSource } from './database-data-source.js';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service.js';
import { ArchivoPendiente } from '../almacenamiento/entities/archivo-pendiente.entity.js';
import { PlantillasPatService } from '../plantillas-pat/plantillas-pat.service.js';
import { DocumentosPatService } from '../documentos-pat/documentos-pat.service.js';
import type { AppEnvironment } from '../config/environment.js';

const schema = `test_conflictos_${randomBytes(8).toString('hex')}`;
let admin: DatabaseDataSource | undefined;
let isolated: DatabaseDataSource | undefined;
let createdSchema = false;
let step = 'conexión y migraciones';
let storage: AlmacenamientoService | undefined;
const objectKeys: string[] = [];
const schemaSql = () => { if (!/^test_conflictos_[a-f0-9]{16}$/.test(schema)) throw new Error('El esquema temporal no es válido.'); return `"${schema}"`; };
const code = (error: unknown) => error instanceof QueryFailedError ? (error.driverError as { code?: string }).code : undefined;

async function verify(): Promise<void> {
  const options = createDatabaseOptions(loadEnvironment());
  admin = new DatabaseDataSource({ ...options, schema: 'public', entities: [], migrations: [] }); await admin.initialize();
  await admin.query(`CREATE SCHEMA ${schemaSql()}`); createdSchema = true;
  const migrations = [CreateUsuario20261002000000, CreateEstudianteDocente20261002010000, CreatePeriodoTitulacion20261002020000, CreateHabilitados20261002030000, CreateLineaInvestigacion20261002040000, CreateTemas20261002050000, CreateGruposInvitaciones20261002060000, GroupIntegrityLifecycle20261002070000, CreatePostulaciones20261002080000, CreateTutoresPropuestos20261002090000, CreateConflictos20261002100000, CreateAsignacionesTema20261002110000, StrengthenAsignacionTemaIntegrity20261002120000, CreateCargaTutorial20261007100000, CreateAsignacionesTutor20261008100000, CreatePlantillasPat20261009100000, CreateDocumentosPat20261010100000, AlignDocumentosPatLockOrder20261011100000];
  isolated = new DatabaseDataSource({ ...options, schema, migrations }); await isolated.initialize(); await isolated.runMigrations({ transaction: 'all' });

  step = 'preparación de postulaciones concurrentes';
  const now = new Date(); const users = isolated.getRepository(Usuario);
  const adminUser = await users.save(users.create({ email: 'admin@conflictos.verify', nombres: 'Admin', apellidos: 'Verificación', rol: UsuarioRol.ADMIN, estado: UsuarioEstado.ACTIVO, id_externo_sso: 'conflictos-admin', ultimo_acceso: null }));
  const teacherUser = await users.save(users.create({ email: 'docente@conflictos.verify', nombres: 'Docente', apellidos: 'Verificación', rol: UsuarioRol.DOCENTE, estado: UsuarioEstado.ACTIVO, id_externo_sso: 'conflictos-docente', ultimo_acceso: null }));
  const teacher = await isolated.getRepository(Docente).save(isolated.getRepository(Docente).create({ usuario: teacherUser, cedula: '0102030400', titulo_academico: 'Magíster', departamento: 'Sistemas', habilitado_tutoria: true }));
  const students: Estudiante[] = [];
  for (const [index, cedula] of ['0102030418', '0102030426', '0102030434', '0102030442', '0102030459'].entries()) {
    const user = await users.save(users.create({ email: `estudiante${index}@conflictos.verify`, nombres: `Estudiante ${index}`, apellidos: 'Verificación', rol: UsuarioRol.ESTUDIANTE, estado: UsuarioEstado.ACTIVO, id_externo_sso: `conflictos-student-${index}`, ultimo_acceso: null }));
    students.push(await isolated.getRepository(Estudiante).save(isolated.getRepository(Estudiante).create({ usuario: user, cedula, matricula: `CF-${index}`, carrera: 'Sistemas', nivel: 8 })));
  }
  const period = await isolated.getRepository(PeriodoTitulacion).save(isolated.getRepository(PeriodoTitulacion).create({ codigo: 'CF-VERIFY', nombre: 'Verificación de conflictos', fecha_inicio_postulacion: new Date(now.getTime() - 60_000), fecha_fin_postulacion: new Date(now.getTime() + 60_000), fecha_inicio_titulacion: new Date(now.getTime() + 600_000), estado: PeriodoEstado.POSTULACION_ABIERTA, max_integrantes_default: 3 }));
  for (const student of students) await isolated.getRepository(EstudianteHabilitado).save(isolated.getRepository(EstudianteHabilitado).create({ periodo: period, estudiante: student, origen: HabilitadoOrigen.MANUAL, lote_importacion: null, estado: HabilitadoEstado.HABILITADO, condicion_ingreso: CondicionIngreso.CONDICIONADO, requisito_pendiente: 'Requisito pendiente', situacion_ingreso: SituacionIngreso.PENDIENTE, fecha_habilitacion: now, fecha_resolucion_ingreso: null, resuelto_por: null, observacion_ingreso: null }));
  const line = await isolated.getRepository(LineaInvestigacion).save(isolated.getRepository(LineaInvestigacion).create({ codigo: 'CF', nombre: 'Conflictos', descripcion: null, activa: true }));
  const topic = await isolated.getRepository(Tema).save(isolated.getRepository(Tema).create({ periodo: period, linea: line, docente_proponente: teacher, titulo: 'Tema de evaluación', descripcion: 'Tema para verificar competencia', min_integrantes: 1, max_integrantes: 1, estado: EstadoTema.PUBLICADO, creado_en: now }));
  const appRepo = isolated.getRepository(Postulacion); const apps: Postulacion[] = [];
  for (const student of students.slice(0, 2)) {
    const application = appRepo.create({ tema: topic, periodo: period, grupo: null, estudiante: student, num_integrantes: 1, registrada_por: student.usuario, estado: EstadoPostulacion.PENDIENTE, observacion: null });
    apps.push(application);
  }
  await isolated.transaction(async (manager) => {
    const saved = await manager.getRepository(Postulacion).save(apps);
    await manager.getRepository(TutorPropuesto).insert(saved.map((item) => ({ postulacion: { id: item.id }, docente: { id: teacher.id }, orden_prioridad: 1 })));
    apps.splice(0, apps.length, ...saved);
  });

  const singleTopic = await isolated.getRepository(Tema).save(isolated.getRepository(Tema).create({ periodo: period, linea: line, docente_proponente: teacher, titulo: 'Tema individual', descripcion: 'Tema para candidatura única.', min_integrantes: 1, max_integrantes: 1, estado: EstadoTema.PUBLICADO, creado_en: now }));
  const groupTopic = await isolated.getRepository(Tema).save(isolated.getRepository(Tema).create({ periodo: period, linea: line, docente_proponente: teacher, titulo: 'Tema grupal', descripcion: 'Tema para candidatura grupal.', min_integrantes: 2, max_integrantes: 3, estado: EstadoTema.PUBLICADO, creado_en: now }));
  const group = await isolated.transaction(async (manager) => {
    const created = await manager.getRepository(Grupo).save(manager.getRepository(Grupo).create({ periodo: period, nombre: 'Grupo asignación', estado: GrupoEstado.ACTIVO }));
    await manager.getRepository(GrupoIntegrante).save([
      manager.getRepository(GrupoIntegrante).create({ grupo: created, periodo: period, estudiante: students[3]!, rol_en_grupo: GrupoIntegranteRol.REPRESENTANTE, estado: GrupoIntegranteEstado.ACTIVO }),
      manager.getRepository(GrupoIntegrante).create({ grupo: created, periodo: period, estudiante: students[4]!, rol_en_grupo: GrupoIntegranteRol.INTEGRANTE, estado: GrupoIntegranteEstado.ACTIVO }),
    ]);
    return created;
  });
  const directApplication = await isolated.transaction(async (manager) => {
    const item = await manager.getRepository(Postulacion).save(manager.getRepository(Postulacion).create({ tema: singleTopic, periodo: period, grupo: null, estudiante: students[2]!, num_integrantes: 1, registrada_por: students[2]!.usuario, estado: EstadoPostulacion.PENDIENTE, observacion: null }));
    await manager.getRepository(TutorPropuesto).insert({ postulacion: { id: item.id }, docente: { id: teacher.id }, orden_prioridad: 1 });
    return item;
  });
  const groupApplication = await isolated.transaction(async (manager) => {
    const item = await manager.getRepository(Postulacion).save(manager.getRepository(Postulacion).create({ tema: groupTopic, periodo: period, grupo: group, estudiante: null, num_integrantes: 2, registrada_por: students[3]!.usuario, estado: EstadoPostulacion.PENDIENTE, observacion: null }));
    await manager.getRepository(TutorPropuesto).insert({ postulacion: { id: item.id }, docente: { id: teacher.id }, orden_prioridad: 1 });
    return item;
  });

  step = 'cierre manual y detección de competencia';
  await isolated.getRepository(PeriodoTitulacion).update(period.id, { fecha_fin_postulacion: new Date(now.getTime() - 1000) });
  const audit = new AuditoriaService(); const periods = new PeriodosService(isolated.getRepository(PeriodoTitulacion), isolated, audit);
  const closed = await periods.cerrarPostulacion(period.id, {}, adminUser, null);
  if (closed.estado !== PeriodoEstado.POSTULACION_CERRADA) throw new Error('El cierre del período no guardó el estado esperado.');
  const service = new ConflictosService(isolated, audit);
  const before = await service.list(period.id, { page: 1, limit: 20 });
  if (before.data.length !== 1 || before.data[0]?.cantidad_postulaciones_elegibles !== 2) throw new Error('No se detectó el conflicto con dos condicionados elegibles.');

  step = 'resolución atómica, puntajes, auditoría y concurrencia';
  const dto = { criterio_aplicado: CriterioConflicto.PROMEDIO, postulacion_ganadora_id: apps[1]!.id, justificacion: 'Decisión documentada por la comisión.', participantes: [{ postulacion_id: apps[0]!.id, puntaje_criterio: 8.25 }, { postulacion_id: apps[1]!.id, puntaje_criterio: 9.5 }] };
  const resolved = await service.resolve(period.id, topic.id, dto, adminUser, null) as { resolucion: { postulacion_ganadora_id: string } | null };
  if (resolved.resolucion?.postulacion_ganadora_id !== apps[1]!.id) throw new Error('La resolución no conservó la postulación ganadora.');
  if (await appRepo.findOneByOrFail({ id: apps[0]!.id }).then((item) => item.estado) !== EstadoPostulacion.PENDIENTE || await isolated.getRepository(Tema).findOneByOrFail({ id: topic.id }).then((item) => item.estado) !== EstadoTema.PUBLICADO) throw new Error('Registrar el conflicto modificó el estado de postulación o tema.');
  const duplicate = await service.resolve(period.id, topic.id, dto, adminUser, null).then(() => false, (error: unknown) => error instanceof HttpException && error.getStatus() === 409);
  if (!duplicate) throw new Error('Se permitió registrar una segunda resolución del mismo tema.');
  const auditCount = await isolated.getRepository(Auditoria).countBy({ accion: 'RESOLVER_CONFLICTO' });
  if (auditCount !== 1) throw new Error('No se registró exactamente una auditoría de resolución.');

  step = 'restricción de ganadora fuera de participantes';
  const secondTopic = await isolated.getRepository(Tema).save(isolated.getRepository(Tema).create({ periodo: period, linea: line, docente_proponente: teacher, titulo: 'Tema sin candidaturas', descripcion: 'Tema separado para probar integridad referencial.', min_integrantes: 1, max_integrantes: 1, estado: EstadoTema.PUBLICADO, creado_en: now }));
  const wrongWinner = await isolated.query(`INSERT INTO ${schemaSql()}."resolucion_conflicto" ("tema_id","periodo_id","resuelto_por_id","criterio_aplicado","postulacion_ganadora_id","justificacion") VALUES ($1,$2,$3,'SORTEO',$4,'Ganadora ajena')`, [secondTopic.id, period.id, adminUser.id, '00000000-0000-4000-8000-000000000000']).then(() => false, (error: unknown) => code(error) === '23503');
  if (!wrongWinner) throw new Error('La referencia de ganadora ajena no produjo una violación FK 23503 independiente.');

  step = 'asignación definitiva concurrente';
  const assignmentAudit = new AuditoriaService();
  const assignmentPersistence = new AsignacionTemaPersistenciaService(assignmentAudit, new AsignacionTutorPersistenciaService(assignmentAudit));
  const habilitadosService = new HabilitadosService(isolated.getRepository(EstudianteHabilitado), isolated, new EstudiantesService(isolated.getRepository(Estudiante), isolated), audit, assignmentPersistence);
  const assignmentsService = new AsignacionesTemaService(isolated.getRepository(AsignacionTema), isolated.getRepository(Estudiante), isolated, habilitadosService, audit, assignmentPersistence);
  const assignDto = { motivo: 'La comisión confirmó la evaluación y seleccionó la candidatura ganadora.' };
  const attempts = await Promise.allSettled([
    assignmentsService.assign(period.id, apps[1]!.id, assignDto, adminUser, null),
    assignmentsService.assign(period.id, apps[1]!.id, assignDto, adminUser, null),
  ]);
  if (attempts.filter((result) => result.status === 'fulfilled').length !== 1) throw new Error('Dos solicitudes concurrentes asignaron ambas el mismo tema.');
  const assignment = await isolated.getRepository(AsignacionTema).findOneByOrFail({ postulacion_id: apps[1]!.id });
  if (assignment.estado !== 'VIGENTE' || await appRepo.findOneByOrFail({ id: apps[1]!.id }).then((item) => item.estado) !== EstadoPostulacion.ACEPTADA || await appRepo.findOneByOrFail({ id: apps[0]!.id }).then((item) => item.estado) !== EstadoPostulacion.RECHAZADA || await isolated.getRepository(Tema).findOneByOrFail({ id: topic.id }).then((item) => item.estado) !== EstadoTema.ASIGNADO) throw new Error('La asignación no actualizó tema y postulaciones de forma atómica.');

  step = 'asignación directa de candidatura única y asignación grupal';
  const directAssignmentResponse = await assignmentsService.assign(period.id, directApplication.id, assignDto, adminUser, null);
  const directAssignment = await isolated.getRepository(AsignacionTema).findOneByOrFail({ postulacion_id: directApplication.id });
  const groupAssignmentResponse = await assignmentsService.assign(period.id, groupApplication.id, assignDto, adminUser, null);
  const groupAssignment = await isolated.getRepository(AsignacionTema).findOneByOrFail({ postulacion_id: groupApplication.id });
  if (directAssignment.estado !== 'VIGENTE' || groupAssignment.estado !== 'VIGENTE' || directAssignmentResponse.postulacion_id !== directApplication.id || groupAssignmentResponse.grupo_id !== group.id) throw new Error('No se asignó la candidatura individual única o la candidatura grupal.');

  step = 'versionado de documentos PAT, integridad de plantilla y asignación';
  const template = await isolated.getRepository(PlantillaPat).save(isolated.getRepository(PlantillaPat).create({
    periodo_id: period.id, periodo: period, version: '1', nombre_archivo: 'plantilla.pdf', ruta_almacenamiento: 'plantillas-pat/verify.pdf',
    mime_type: 'application/pdf', tamano_bytes: '12', hash_sha256: 'a'.repeat(64), fecha_vigencia_inicio: '2026-10-08', fecha_vigencia_fin: null,
    publicada_por_id: adminUser.id, publicada_por: adminUser, activa: true,
  }));
  const addDocument = async (version: number, key: string, plantillaId = template.id, assignmentId = directAssignment.id) => isolated!.transaction(async (manager) => {
    await manager.query(`INSERT INTO ${schemaSql()}."archivo_limpieza_pendiente" ("ruta_almacenamiento") VALUES ($1)`, [key]);
    const document = await manager.getRepository(DocumentoPat).save(manager.getRepository(DocumentoPat).create({
      asignacion_tema_id: assignmentId, asignacion_tema: { id: assignmentId } as AsignacionTema,
      plantilla_id: plantillaId, plantilla: { id: plantillaId } as PlantillaPat,
      version, nombre_archivo: `entrega-${version}.pdf`, ruta_almacenamiento: key,
      formato: DocumentoPatFormato.PDF, tamano_bytes: '12', hash_sha256: 'b'.repeat(64),
      cargado_por_id: students[2]!.usuario.id, cargado_por: students[2]!.usuario,
    }));
    await manager.query(`DELETE FROM ${schemaSql()}."archivo_limpieza_pendiente" WHERE "ruta_almacenamiento"=$1`, [key]);
    return document;
  });
  const firstDocument = await addDocument(1, 'documentos-pat/verify-1.pdf');
  await addDocument(2, 'documentos-pat/verify-2.pdf');
  if (await isolated.getRepository(DocumentoPat).countBy({ asignacion_tema_id: directAssignment.id }) !== 2 || firstDocument.hash_sha256 !== 'b'.repeat(64)) throw new Error('No se conservaron las dos versiones PAT y su hash.');
  step = 'migración de revisiones sobre versiones PAT históricas';
  const revisionMigration = new CreateRevisionesPat20261012100000();
  const revisionRunner = isolated.createQueryRunner(); await revisionRunner.connect(); await revisionRunner.startTransaction();
  try { await revisionMigration.up(revisionRunner); await revisionRunner.commitTransaction(); }
  catch (error: unknown) { if (revisionRunner.isTransactionActive) await revisionRunner.rollbackTransaction(); throw error; }
  finally { await revisionRunner.release(); }
  const documentsService = new DocumentosPatService(isolated.getRepository(DocumentoPat), isolated, { signPrivateDownload: async () => '' } as unknown as AlmacenamientoService, {} as never, new AuditoriaService());
  const reviewsService = new RevisionesPatService(isolated.getRepository(RevisionPat), isolated, documentsService, new AuditoriaService());
  const historicalApproval = await reviewsService.crear(period.id, directAssignment.id, firstDocument.id, { resultado: RevisionPatResultado.APROBADO }, adminUser, null);
  const latestStillPending = await isolated.query(`SELECT r."resultado"::text AS resultado FROM ${schemaSql()}."documento_pat" d LEFT JOIN ${schemaSql()}."revision_pat" r ON r."documento_pat_id"=d."id" WHERE d."asignacion_tema_id"=$1 ORDER BY d."version" DESC LIMIT 1`, [directAssignment.id]) as Array<{ resultado: string | null }>;
  if (historicalApproval.resultado !== RevisionPatResultado.APROBADO || latestStillPending[0]?.resultado !== null) throw new Error('Revisar una versión histórica alteró la situación de la última versión.');
  const pendingCorrectionRejected = await addDocument(3, 'documentos-pat/pending-review-rejected.pdf').then(() => false, (error: unknown) => code(error) === '23514');
  if (!pendingCorrectionRejected) throw new Error('PostgreSQL permitió una corrección mientras la última versión seguía pendiente.');
  const latestDocument = await isolated.getRepository(DocumentoPat).findOneByOrFail({ asignacion_tema_id: directAssignment.id, version: 2 });
  await reviewsService.crear(period.id, directAssignment.id, latestDocument.id, { resultado: RevisionPatResultado.OBSERVADO, observaciones: 'Completar la metodología.' }, adminUser, null);
  const duplicateDocVersion = await addDocument(2, 'documentos-pat/verify-duplicate.pdf').then(() => false, (error: unknown) => code(error) === '23505');
  if (!duplicateDocVersion) throw new Error('La base de datos no protegió la unicidad de versión por asignación.');
  const duplicateReview = await reviewsService.crear(period.id, directAssignment.id, latestDocument.id, { resultado: RevisionPatResultado.RECHAZADO, observaciones: 'Segunda revisión.' }, adminUser, null).then(() => false, (error: unknown) => error instanceof HttpException && error.getStatus() === 409);
  if (!duplicateReview) throw new Error('Se permitió revisar dos veces el mismo documento PAT.');
  const blankObservationsRejected = await isolated.query(`INSERT INTO ${schemaSql()}."revision_pat" ("documento_pat_id","revisor_id","resultado","observaciones") VALUES ($1,$2,'RECHAZADO','   ')`, [latestDocument.id, adminUser.id]).then(() => false, (error: unknown) => code(error) === '23514');
  if (!blankObservationsRejected) throw new Error('PostgreSQL permitió observar o rechazar sin observaciones válidas.');
  const correctedDocument = await addDocument(3, 'documentos-pat/verify-correction.pdf');
  if (correctedDocument.version !== 3) throw new Error('No se permitió una corrección posterior a OBSERVADO.');
  await reviewsService.crear(period.id, directAssignment.id, correctedDocument.id, { resultado: RevisionPatResultado.OBSERVADO, observaciones: 'Aclarar el resultado esperado.' }, adminUser, null);
  step = 'numeración única bajo entregas concurrentes';
  const simultaneousVersions = await Promise.allSettled([
    addDocument(4, 'documentos-pat/verify-race-a.pdf'),
    addDocument(4, 'documentos-pat/verify-race-b.pdf'),
  ]);
  if (simultaneousVersions.filter((result) => result.status === 'fulfilled').length !== 1) throw new Error('Dos cargas concurrentes guardaron el mismo número de versión PAT.');
  const latestCorrection = await isolated.getRepository(DocumentoPat).findOneByOrFail({ asignacion_tema_id: directAssignment.id, version: 4 });
  const concurrentReviews = await Promise.allSettled([
    reviewsService.crear(period.id, directAssignment.id, latestCorrection.id, { resultado: RevisionPatResultado.APROBADO }, adminUser, null),
    reviewsService.crear(period.id, directAssignment.id, latestCorrection.id, { resultado: RevisionPatResultado.APROBADO }, adminUser, null),
  ]);
  if (concurrentReviews.filter((result) => result.status === 'fulfilled').length !== 1) throw new Error('Dos revisiones concurrentes fueron guardadas para una misma versión.');
  const correctionAfterApprovalRejected = await addDocument(5, 'documentos-pat/approved-review-rejected.pdf').then(() => false, (error: unknown) => code(error) === '23514');
  if (!correctionAfterApprovalRejected) throw new Error('PostgreSQL permitió una nueva carga después de aprobar la última versión.');
  const immutableReview = await isolated.query(`UPDATE ${schemaSql()}."revision_pat" SET "observaciones"='alterada' WHERE "documento_pat_id"=$1`, [latestCorrection.id]).then(() => false, (error: unknown) => code(error) === '23514');
  const reviewDeleteBlocked = await isolated.query(`DELETE FROM ${schemaSql()}."revision_pat" WHERE "documento_pat_id"=$1`, [latestCorrection.id]).then(() => false, (error: unknown) => code(error) === '23514');
  if (!immutableReview || !reviewDeleteBlocked) throw new Error('PostgreSQL permitió alterar o eliminar una revisión histórica.');
  step = 'rollback de revisión ante fallo de auditoría';
  const rollbackDocument = await addDocument(1, 'documentos-pat/revision-audit-rollback.pdf', template.id, groupAssignment.id);
  const groupHistoryStillPending = await isolated.getRepository(DocumentoPat).countBy({ asignacion_tema_id: groupAssignment.id });
  if (groupHistoryStillPending !== 1) throw new Error('No se preparó una versión independiente para comprobar rollback de auditoría.');
  const failedAuditReviews = new RevisionesPatService(isolated.getRepository(RevisionPat), isolated, documentsService, { registrar: async () => { throw new Error('fallo de auditoría provocado'); } } as unknown as AuditoriaService);
  const auditRollback = await failedAuditReviews.crear(period.id, groupAssignment.id, rollbackDocument.id, { resultado: RevisionPatResultado.OBSERVADO, observaciones: 'Prueba de rollback.' }, adminUser, null).then(() => false, () => true);
  if (!auditRollback || await isolated.getRepository(RevisionPat).countBy({ documento_pat_id: rollbackDocument.id }) !== 0) throw new Error('La revisión quedó guardada aunque falló su auditoría.');
  await reviewsService.crear(period.id, groupAssignment.id, rollbackDocument.id, { resultado: RevisionPatResultado.OBSERVADO, observaciones: 'Prueba de auditoría recuperada.' }, adminUser, null);
  const documentImmutable = await isolated.query(`UPDATE ${schemaSql()}."documento_pat" SET "version"=3 WHERE "id"=$1`, [firstDocument.id]).then(() => false, (error: unknown) => code(error) === '23514');
  const documentDeleteBlocked = await isolated.query(`DELETE FROM ${schemaSql()}."documento_pat" WHERE "id"=$1`, [firstDocument.id]).then(() => false, (error: unknown) => code(error) === '23514');
  if (!documentImmutable || !documentDeleteBlocked) throw new Error('PostgreSQL permitió alterar o eliminar un documento PAT histórico.');
  step = 'rechazo de plantilla de otro período';
  const unrelatedPeriod = await isolated.getRepository(PeriodoTitulacion).save(isolated.getRepository(PeriodoTitulacion).create({ codigo: 'CF-DOC-OTHER', nombre: 'Período distinto', fecha_inicio_postulacion: new Date(now.getTime() - 60_000), fecha_fin_postulacion: new Date(now.getTime() + 60_000), fecha_inicio_titulacion: new Date(now.getTime() + 600_000), estado: PeriodoEstado.POSTULACION_CERRADA, max_integrantes_default: 3 }));
  const unrelatedTemplate = await isolated.getRepository(PlantillaPat).save(isolated.getRepository(PlantillaPat).create({
    periodo_id: unrelatedPeriod.id, periodo: unrelatedPeriod, version: '1', nombre_archivo: 'otra.pdf', ruta_almacenamiento: 'plantillas-pat/other.pdf',
    mime_type: 'application/pdf', tamano_bytes: '12', hash_sha256: 'c'.repeat(64), fecha_vigencia_inicio: '2026-10-08', fecha_vigencia_fin: null,
    publicada_por_id: adminUser.id, publicada_por: adminUser, activa: true,
  }));
  const crossPeriodTemplate = await addDocument(4, 'documentos-pat/cross-period.pdf', unrelatedTemplate.id).then(() => false, (error: unknown) => code(error) === '23514');
  if (!crossPeriodTemplate) throw new Error('Se permitió vincular un documento PAT con una plantilla de otro período.');

  step = 'migración reversible del período asociado a intención de archivo';
  const pendingPath = 'plantillas-pat/verify.pdf';
  await isolated.query(`INSERT INTO ${schemaSql()}."archivo_limpieza_pendiente" ("periodo_id","ruta_almacenamiento") VALUES ($1,$2)`, [period.id, pendingPath]);
  const alignmentMigration = new AlignDocumentosPatLockOrder20261011100000();
  const alignmentRunner = isolated.createQueryRunner(); await alignmentRunner.connect(); await alignmentRunner.startTransaction();
  try { await alignmentMigration.down(alignmentRunner); await alignmentMigration.up(alignmentRunner); await alignmentRunner.commitTransaction(); }
  catch (error: unknown) { if (alignmentRunner.isTransactionActive) await alignmentRunner.rollbackTransaction(); throw error; }
  finally { await alignmentRunner.release(); }
  const recoveredIntent = await isolated.query(`SELECT "periodo_id" FROM ${schemaSql()}."archivo_limpieza_pendiente" WHERE "ruta_almacenamiento"=$1`, [pendingPath]) as Array<{ periodo_id: string | null }>;
  if (recoveredIntent[0]?.periodo_id !== period.id) throw new Error('La reversión/reaplicación de la intención no reconstruyó su período desde la plantilla histórica.');
  await isolated.query(`DELETE FROM ${schemaSql()}."archivo_limpieza_pendiente" WHERE "ruta_almacenamiento"=$1`, [pendingPath]);

  const environment = loadEnvironment();
  if (environment.S3_ENDPOINT) {
    step = 'integración S3/SSE-S3: publicación, dos versiones y descarga SHA-256';
    storage = new AlmacenamientoService(new ConfigService<AppEnvironment, true>(environment as AppEnvironment));
    const cleanup = {
      registrar: async (periodId: string, key: string) => isolated!.getRepository(ArchivoPendiente).save(isolated!.getRepository(ArchivoPendiente).create({ periodo_id: periodId, ruta_almacenamiento: key, estado: 'SUBIENDO' })),
      solicitar: async (_manager: undefined, key: string) => isolated!.getRepository(ArchivoPendiente).update({ ruta_almacenamiento: key }, { estado: 'LIMPIEZA' }),
    };
    const plantillaService = new PlantillasPatService(
      isolated.getRepository(PlantillaPat), isolated.getRepository(PeriodoTitulacion), isolated.getRepository(Estudiante), isolated.getRepository(EstudianteHabilitado),
      isolated, storage, new AuditoriaService(), cleanup as never,
    );
    const pdfBuffer = Buffer.from('%PDF-1.7\nprueba integrada de plantilla\n%%EOF');
    step = 'integración S3: publicación de plantilla';
    const published = await plantillaService.publicar(period.id, { version: 'S3-INTEGRADA' }, { originalname: 'plantilla-integrada.pdf', mimetype: 'application/pdf', size: pdfBuffer.length, buffer: pdfBuffer } as Express.Multer.File, adminUser, null);
    const templateObject = await isolated.getRepository(PlantillaPat).findOneByOrFail({ id: published.id });
    objectKeys.push(templateObject.ruta_almacenamiento);
    const docsService = new DocumentosPatService(isolated.getRepository(DocumentoPat), isolated, storage, cleanup as never, new AuditoriaService());
    const patBuffer = Buffer.from('%PDF-1.7\nversión PAT integrada\n%%EOF');
    const patFile = { originalname: 'entrega-integrada.pdf', mimetype: 'application/pdf', size: patBuffer.length, buffer: patBuffer } as Express.Multer.File;
    step = 'integración S3: primera entrega PAT grupal';
    const first = await docsService.cargar(period.id, groupAssignment.id, { plantilla_id: published.id }, patFile, students[3]!.usuario, null);
    step = 'integración: registrar observación';
    await reviewsService.crear(period.id, groupAssignment.id, first.id, { resultado: RevisionPatResultado.OBSERVADO, observaciones: 'Entrega de prueba para corregir.' }, adminUser, null);
    step = 'integración S3: corrección posterior a observación';
    const second = await docsService.cargar(period.id, groupAssignment.id, { plantilla_id: published.id }, patFile, students[3]!.usuario, null);
    if (second.version !== first.version + 1) throw new Error('La carga PAT integrada no generó versiones consecutivas.');
    for (const item of [first, second]) {
      const row = await isolated.getRepository(DocumentoPat).findOneByOrFail({ id: item.id });
      objectKeys.push(row.ruta_almacenamiento);
      const download = await docsService.descargarPorId(period.id, groupAssignment.id, item.id, students[3]!.usuario);
      const response = await fetch(download.url);
      const bytes = Buffer.from(await response.arrayBuffer());
      const downloadedHash = createHash('sha256').update(bytes).digest('hex');
      if (!response.ok || downloadedHash !== item.hash_sha256) throw new Error(`La descarga PAT ${item.version} no conservó el SHA-256.`);
    }
  }
  step = 'consulta administrativa de asignaciones';
  const adminAssignments = await assignmentsService.list(period.id, { page: 1, limit: 20 }, adminUser, true);
  step = 'consulta docente de asignaciones';
  const teacherAssignments = await assignmentsService.list(period.id, { page: 1, limit: 20 }, teacherUser, false);
  step = 'consulta propia de asignaciones grupales';
  const groupStudentAssignments = await assignmentsService.listMine(period.id, students[4]!.usuario, { page: 1, limit: 20 });
  step = 'consulta de detalle de asignación por integrante';
  const groupDetail = await assignmentsService.getById(period.id, groupAssignment.id, students[4]!.usuario, false);
  if (adminAssignments.total !== 3 || teacherAssignments.total !== 3 || groupStudentAssignments.total !== 1 || groupDetail.participantes.length !== 2 || 'email' in groupDetail.participantes[0]!) throw new Error('Las consultas de asignación no respetan paginación, acceso por recurso o privacidad.');

  step = 'carga tutorial, asignación concurrente y reemplazo';
  const newTeacherUser = await users.save(users.create({ email: 'docente-reemplazo@conflictos.verify', nombres: 'Docente', apellidos: 'Reemplazo', rol: UsuarioRol.DOCENTE, estado: UsuarioEstado.ACTIVO, id_externo_sso: 'conflictos-docente-reemplazo', ultimo_acceso: null }));
  const replacementTeacher = await isolated.getRepository(Docente).save(isolated.getRepository(Docente).create({ usuario: newTeacherUser, cedula: '0102030467', titulo_academico: 'Magíster', departamento: 'Sistemas', habilitado_tutoria: true }));
  await isolated.getRepository(PeriodoTitulacion).update(period.id, { estado: PeriodoEstado.POSTULACION_CERRADA });
  const loadRepo = isolated.getRepository(ConfigCargaTutorial);
  await loadRepo.save(loadRepo.create({ periodo_id: period.id, periodo: period, docente_id: null, docente: null, max_trabajos: 1, bloquear_al_superar: true }));
  await loadRepo.save(loadRepo.create({ periodo_id: period.id, periodo: period, docente_id: replacementTeacher.id, docente: replacementTeacher, max_trabajos: 1, bloquear_al_superar: true }));
  const tutorAudit = new AuditoriaService();
  const tutorService = new AsignacionesTutorService(
    isolated.getRepository(AsignacionTutor), isolated.getRepository(AsignacionTema), isolated.getRepository(PeriodoTitulacion),
    isolated.getRepository(Docente), isolated.getRepository(Estudiante), isolated.getRepository(GrupoIntegrante),
    isolated.getRepository(TutorPropuesto), isolated, tutorAudit, new CargaTutorialPersistenciaService(),
  );
  const tutorDto = { docente_id: teacher.id };
  const concurrentTutorAssignments = await Promise.allSettled([
    tutorService.asignar(period.id, assignment.id, tutorDto, adminUser, null),
    tutorService.asignar(period.id, directAssignment.id, tutorDto, adminUser, null),
  ]);
  const tutorSuccesses = concurrentTutorAssignments.filter((result) => result.status === 'fulfilled');
  if (tutorSuccesses.length !== 1) throw new Error('El bloqueo de carga permitió más de una asignación al último cupo tutorial.');
  const currentTutorWorkId = tutorSuccesses[0]!.status === 'fulfilled' ? tutorSuccesses[0]!.value.asignacion.asignacion_tema_id : '';
  const currentTutor = await isolated.getRepository(AsignacionTutor).findOneByOrFail({ asignacion_tema_id: currentTutorWorkId });
  const replaced = await tutorService.reemplazar(period.id, currentTutor.id, { docente_id: replacementTeacher.id, motivo: 'Reemplazo verificado en esquema temporal.' }, adminUser, null);
  const oldTutor = await isolated.getRepository(AsignacionTutor).findOneByOrFail({ id: currentTutor.id });
  const newTutor = await isolated.getRepository(AsignacionTutor).findOneByOrFail({ id: replaced.asignacion.id });
  if (oldTutor.estado !== 'REEMPLAZADA' || oldTutor.motivo_cambio !== 'Reemplazo verificado en esquema temporal.' || newTutor.estado !== 'VIGENTE') throw new Error('El reemplazo no conservó el tutor anterior y el nuevo registro vigente.');
  const tutorAuditCount = await isolated.getRepository(Auditoria).countBy({ accion: 'ASIGNAR_TUTOR' }) + await isolated.getRepository(Auditoria).countBy({ accion: 'REEMPLAZAR_TUTOR' });
  if (tutorAuditCount !== 2) throw new Error('La asignación y reemplazo de tutor no registraron auditoría atómica.');
  const secondTutorRejected = await isolated.getRepository(AsignacionTutor).insert({ asignacion_tema_id: currentTutorWorkId, docente_id: replacementTeacher.id, tutor_propuesto_id: null, tipo: AsignacionTutorTipo.ASIGNADO_DIRECTO, estado: AsignacionTutorEstado.VIGENTE, asignada_por_id: adminUser.id }).then(() => false, (error: unknown) => code(error) === '23505' || code(error) === '23514');
  const activeTutorsForWork = await isolated.getRepository(AsignacionTutor).countBy({ asignacion_tema_id: currentTutorWorkId, estado: AsignacionTutorEstado.VIGENTE });
  if (!secondTutorRejected || activeTutorsForWork !== 1) throw new Error('PostgreSQL permitió dos tutores vigentes para el mismo trabajo.');

  step = 'protección de solapamiento entre grupo e individuo';
  const otherPeriod = await isolated.getRepository(PeriodoTitulacion).save(isolated.getRepository(PeriodoTitulacion).create({ codigo: 'CF-CROSS', nombre: 'Verificación de solapamiento', fecha_inicio_postulacion: new Date(now.getTime() - 60_000), fecha_fin_postulacion: new Date(now.getTime() + 300_000), fecha_inicio_titulacion: new Date(now.getTime() + 600_000), estado: PeriodoEstado.POSTULACION_ABIERTA, max_integrantes_default: 3 }));
  await isolated.getRepository(EstudianteHabilitado).save(isolated.getRepository(EstudianteHabilitado).create({ periodo: otherPeriod, estudiante: students[3]!, origen: HabilitadoOrigen.MANUAL, lote_importacion: null, estado: HabilitadoEstado.HABILITADO, condicion_ingreso: CondicionIngreso.REGULAR, requisito_pendiente: null, situacion_ingreso: SituacionIngreso.ADMITIDO, fecha_habilitacion: now, fecha_resolucion_ingreso: now, resuelto_por: adminUser, observacion_ingreso: null }));
  const otherTopic = await isolated.getRepository(Tema).save(isolated.getRepository(Tema).create({ periodo: otherPeriod, linea: line, docente_proponente: teacher, titulo: 'Tema del otro período', descripcion: 'Prueba de asignación individual cruzada.', min_integrantes: 1, max_integrantes: 1, estado: EstadoTema.PUBLICADO, creado_en: now }));
  const crossApplication = await isolated.transaction(async (manager) => {
    const item = await manager.getRepository(Postulacion).save(manager.getRepository(Postulacion).create({ tema: otherTopic, periodo: otherPeriod, grupo: null, estudiante: students[3]!, num_integrantes: 1, registrada_por: students[3]!.usuario, estado: EstadoPostulacion.PENDIENTE, observacion: null }));
    await manager.getRepository(TutorPropuesto).insert({ postulacion: { id: item.id }, docente: { id: teacher.id }, orden_prioridad: 1 });
    return item;
  });
  const overlapRejected = await isolated.transaction(async (manager) => {
    await manager.query(`UPDATE ${schemaSql()}."postulacion" SET "estado"='ACEPTADA',"observacion"='Intento de verificación' WHERE "id"=$1`, [crossApplication.id]);
    await manager.query(`INSERT INTO ${schemaSql()}."asignacion_tema" ("tema_id","periodo_id","postulacion_id","estudiante_id","aprobada_por_id","motivo") VALUES ($1,$2,$3,$4,$5,'Intento de solapamiento')`, [otherTopic.id, otherPeriod.id, crossApplication.id, students[3]!.id, adminUser.id]);
  }).then(() => false, (error: unknown) => code(error) === '23505');
  if (!overlapRejected || await appRepo.findOneByOrFail({ id: crossApplication.id }).then((item) => item.estado) !== EstadoPostulacion.PENDIENTE) throw new Error('PostgreSQL permitió la doble asignación individual y grupal del mismo estudiante.');

  step = 'rechazo de ADMITIDO tardío';
  await isolated.getRepository(PeriodoTitulacion).update(period.id, { fecha_inicio_titulacion: new Date(now.getTime() - 1000) });
  const pendingHabilitation = await isolated.getRepository(EstudianteHabilitado).findOneByOrFail({ periodo: { id: period.id }, estudiante: { id: students[0]!.id } });
  const lateAdmissionRejected = await habilitadosService.resolve(period.id, pendingHabilitation.id, adminUser, { situacion_ingreso: SituacionIngreso.ADMITIDO }, null).then(() => false, (error: unknown) => error instanceof HttpException && error.getStatus() === 409);
  if (!lateAdmissionRejected) throw new Error('Se permitió resolver ADMITIDO después del inicio de titulación.');

  step = 'anulación individual tardía por NO_ADMITIDO';
  const winnerHabilitation = await isolated.getRepository(EstudianteHabilitado).findOneByOrFail({ periodo: { id: period.id }, estudiante: { id: students[1]!.id } });
  await habilitadosService.resolve(period.id, winnerHabilitation.id, adminUser, { situacion_ingreso: SituacionIngreso.NO_ADMITIDO, observacion_ingreso: 'No cumplió el requisito pendiente.' }, null);
  if (await isolated.getRepository(AsignacionTema).findOneByOrFail({ id: assignment.id }).then((item) => item.estado) !== 'ANULADA' || await appRepo.findOneByOrFail({ id: apps[1]!.id }).then((item) => item.estado) !== EstadoPostulacion.ANULADA || await isolated.getRepository(Tema).findOneByOrFail({ id: topic.id }).then((item) => item.estado) !== EstadoTema.PUBLICADO) throw new Error('NO_ADMITIDO no anuló la asignación y postulación ni republicó el tema.');

  step = 'anulación completa de grupo condicionado';
  const groupHabilitation = await isolated.getRepository(EstudianteHabilitado).findOneByOrFail({ periodo: { id: period.id }, estudiante: { id: students[3]!.id } });
  await habilitadosService.resolve(period.id, groupHabilitation.id, adminUser, { situacion_ingreso: SituacionIngreso.NO_ADMITIDO, observacion_ingreso: 'Incumplió la condición de ingreso.' }, null);
  if (await isolated.getRepository(AsignacionTema).findOneByOrFail({ id: groupAssignment.id }).then((item) => item.estado) !== 'ANULADA' || await appRepo.findOneByOrFail({ id: groupApplication.id }).then((item) => item.estado) !== EstadoPostulacion.ANULADA || await isolated.getRepository(Tema).findOneByOrFail({ id: groupTopic.id }).then((item) => item.estado) !== EstadoTema.PUBLICADO || await isolated.getRepository(Grupo).findOneByOrFail({ id: group.id }).then((item) => item.estado) !== GrupoEstado.ACTIVO || await isolated.getRepository(GrupoIntegrante).countBy({ grupo: { id: group.id }, estado: GrupoIntegranteEstado.ACTIVO }) !== 2) throw new Error('NO_ADMITIDO no anuló toda la asignación grupal o alteró el historial de integrantes.');
  const historicalStudentAssignments = await assignmentsService.listMine(period.id, students[4]!.usuario, { page: 1, limit: 20, estado: AsignacionTemaEstado.ANULADA });
  if (historicalStudentAssignments.total !== 1 || historicalStudentAssignments.data[0]?.estado !== 'ANULADA') throw new Error('El estudiante no puede consultar la asignación grupal anulada como historial.');

  step = 'protección de coherencia tema-asignación y reversibilidad del refuerzo';
  const topicStateRejected = await isolated.getRepository(Tema).update({ id: singleTopic.id }, { estado: EstadoTema.PUBLICADO }).then(() => false, (error: unknown) => code(error) === '23514');
  if (!topicStateRejected) throw new Error('PostgreSQL permitió republicar un tema con asignación vigente.');
  const strengthenMigration = new StrengthenAsignacionTemaIntegrity20261002120000();
  const strengthenRunner = isolated.createQueryRunner();
  await strengthenRunner.connect();
  await strengthenRunner.startTransaction();
  try {
    await strengthenMigration.down(strengthenRunner);
    await strengthenMigration.up(strengthenRunner);
    await strengthenRunner.commitTransaction();
  } catch (error: unknown) {
    if (strengthenRunner.isTransactionActive) await strengthenRunner.rollbackTransaction();
    throw error;
  } finally {
    await strengthenRunner.release();
  }

  step = 'reversión protegida de documentos PAT';
  const documentMigration = new CreateDocumentosPat20261010100000();
  const documentRunner = isolated.createQueryRunner(); await documentRunner.connect(); await documentRunner.startTransaction();
  const documentsProtected = await documentMigration.down(documentRunner).then(() => false, async (error: unknown) => { if (documentRunner.isTransactionActive) await documentRunner.rollbackTransaction(); return error instanceof Error && error.message.includes('documentos PAT'); });
  if (documentRunner.isTransactionActive) await documentRunner.rollbackTransaction(); await documentRunner.release();
  if (!documentsProtected) throw new Error('La reversión permitió eliminar documentos PAT o intenciones de carga.');

  step = 'reversión protegida de revisiones PAT';
  const revisionDownRunner = isolated.createQueryRunner(); await revisionDownRunner.connect(); await revisionDownRunner.startTransaction();
  const revisionsProtected = await revisionMigration.down(revisionDownRunner).then(() => false, async (error: unknown) => { if (revisionDownRunner.isTransactionActive) await revisionDownRunner.rollbackTransaction(); return error instanceof Error && error.message.includes('revisiones PAT'); });
  if (revisionDownRunner.isTransactionActive) await revisionDownRunner.rollbackTransaction(); await revisionDownRunner.release();
  if (!revisionsProtected) throw new Error('La reversión permitió eliminar revisiones PAT históricas.');

  step = 'reversión protegida';
  const migration = new CreateConflictos20261002100000(); const runner = isolated.createQueryRunner(); await runner.connect(); await runner.startTransaction();
  const protectedDown = await migration.down(runner).then(() => false, async (error: unknown) => { await runner.rollbackTransaction(); return error instanceof Error && error.message.includes('hay resoluciones'); });
  if (runner.isTransactionActive) await runner.rollbackTransaction(); await runner.release();
  if (!protectedDown) throw new Error('La reversión permitió eliminar el historial de conflictos.');
  console.log('Verificación temporal correcta: conflictos, asignaciones de tema y tutor, cargas y versionado PAT con integridad histórica.');
}

try { await verify(); }
catch (error: unknown) { const cause = error instanceof HttpException ? (error as HttpException & { cause?: unknown }).cause : undefined; const detail = error instanceof HttpException ? `${error.getStatus()} ${error.message}${cause instanceof Error ? ` Detalle técnico: ${cause.message}` : ''}` : error instanceof Error ? error.message : 'error no especificado'; console.error(`Falló la verificación de conflictos durante: ${step}. ${detail}`); process.exitCode = 1; }
finally { if (storage) { for (const key of objectKeys) await storage.removePrivate(key).catch(() => undefined); await storage.onModuleDestroy(); } if (isolated?.isInitialized) await isolated.destroy().catch(() => undefined); if (admin?.isInitialized && createdSchema) await admin.query(`DROP SCHEMA IF EXISTS ${schemaSql()} CASCADE`).catch(() => undefined); if (admin?.isInitialized) await admin.destroy().catch(() => undefined); }
