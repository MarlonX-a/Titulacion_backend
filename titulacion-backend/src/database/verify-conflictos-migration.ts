import { randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { Auditoria } from '../auditoria/entities/auditoria.entity.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { AsignacionTemaPersistenciaService } from '../asignaciones-tema/asignacion-tema-persistencia.service.js';
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

const schema = `test_conflictos_${randomBytes(8).toString('hex')}`;
let admin: DatabaseDataSource | undefined;
let isolated: DatabaseDataSource | undefined;
let createdSchema = false;
let step = 'conexión y migraciones';
const schemaSql = () => { if (!/^test_conflictos_[a-f0-9]{16}$/.test(schema)) throw new Error('El esquema temporal no es válido.'); return `"${schema}"`; };
const code = (error: unknown) => error instanceof QueryFailedError ? (error.driverError as { code?: string }).code : undefined;

async function verify(): Promise<void> {
  const options = createDatabaseOptions(loadEnvironment());
  admin = new DatabaseDataSource({ ...options, schema: 'public', entities: [], migrations: [] }); await admin.initialize();
  await admin.query(`CREATE SCHEMA ${schemaSql()}`); createdSchema = true;
  const migrations = [CreateUsuario20261002000000, CreateEstudianteDocente20261002010000, CreatePeriodoTitulacion20261002020000, CreateHabilitados20261002030000, CreateLineaInvestigacion20261002040000, CreateTemas20261002050000, CreateGruposInvitaciones20261002060000, GroupIntegrityLifecycle20261002070000, CreatePostulaciones20261002080000, CreateTutoresPropuestos20261002090000, CreateConflictos20261002100000, CreateAsignacionesTema20261002110000, StrengthenAsignacionTemaIntegrity20261002120000];
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
  const assignmentPersistence = new AsignacionTemaPersistenciaService(new AuditoriaService());
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
  step = 'consulta administrativa de asignaciones';
  const adminAssignments = await assignmentsService.list(period.id, { page: 1, limit: 20 }, adminUser, true);
  step = 'consulta docente de asignaciones';
  const teacherAssignments = await assignmentsService.list(period.id, { page: 1, limit: 20 }, teacherUser, false);
  step = 'consulta propia de asignaciones grupales';
  const groupStudentAssignments = await assignmentsService.listMine(period.id, students[4]!.usuario, { page: 1, limit: 20 });
  step = 'consulta de detalle de asignación por integrante';
  const groupDetail = await assignmentsService.getById(period.id, groupAssignment.id, students[4]!.usuario, false);
  if (adminAssignments.total !== 3 || teacherAssignments.total !== 3 || groupStudentAssignments.total !== 1 || groupDetail.participantes.length !== 2 || 'email' in groupDetail.participantes[0]!) throw new Error('Las consultas de asignación no respetan paginación, acceso por recurso o privacidad.');

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

  step = 'reversión protegida';
  const migration = new CreateConflictos20261002100000(); const runner = isolated.createQueryRunner(); await runner.connect(); await runner.startTransaction();
  const protectedDown = await migration.down(runner).then(() => false, async (error: unknown) => { await runner.rollbackTransaction(); return error instanceof Error && error.message.includes('hay resoluciones'); });
  if (runner.isTransactionActive) await runner.rollbackTransaction(); await runner.release();
  if (!protectedDown) throw new Error('La reversión permitió eliminar el historial de conflictos.');
  console.log('Verificación de conflictos y asignaciones correcta: cierre, detección, ganadora, concurrencia, auditoría y anulación por NO_ADMITIDO.');
}

try { await verify(); }
catch (error: unknown) { const cause = error instanceof HttpException ? (error as HttpException & { cause?: unknown }).cause : undefined; const detail = error instanceof HttpException ? `${error.getStatus()} ${error.message}${cause instanceof Error ? ` Detalle técnico: ${cause.message}` : ''}` : error instanceof Error ? error.message : 'error no especificado'; console.error(`Falló la verificación de conflictos durante: ${step}. ${detail}`); process.exitCode = 1; }
finally { if (isolated?.isInitialized) await isolated.destroy().catch(() => undefined); if (admin?.isInitialized && createdSchema) await admin.query(`DROP SCHEMA IF EXISTS ${schemaSql()} CASCADE`).catch(() => undefined); if (admin?.isInitialized) await admin.destroy().catch(() => undefined); }
