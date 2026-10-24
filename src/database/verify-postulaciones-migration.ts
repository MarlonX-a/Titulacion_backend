import { randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { Auditoria } from '../auditoria/entities/auditoria.entity.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { AsignacionTemaPersistenciaService } from '../asignaciones-tema/asignacion-tema-persistencia.service.js';
import { AsignacionTutorPersistenciaService } from '../asignaciones-tutor/asignacion-tutor-persistencia.service.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { EstudiantesService } from '../estudiantes/estudiantes.service.js';
import { EstudianteHabilitado } from '../habilitados/entities/estudiante-habilitado.entity.js';
import { HabilitadosService } from '../habilitados/habilitados.service.js';
import { CondicionIngreso } from '../habilitados/enums/condicion-ingreso.enum.js';
import { HabilitadoEstado } from '../habilitados/enums/habilitado-estado.enum.js';
import { HabilitadoOrigen } from '../habilitados/enums/habilitado-origen.enum.js';
import { SituacionIngreso } from '../habilitados/enums/situacion-ingreso.enum.js';
import { LoteImportacion } from '../importaciones/entities/lote-importacion.entity.js';
import { LineaInvestigacion } from '../lineas-investigacion/entities/linea-investigacion.entity.js';
import { Grupo } from '../grupos/entities/grupo.entity.js';
import { GrupoIntegrante } from '../grupos/entities/grupo-integrante.entity.js';
import { GruposService } from '../grupos/grupos.service.js';
import { GrupoGestionService } from '../grupos/grupo-gestion.service.js';
import { CreateGrupoDto } from '../grupos/dto/create-grupo.dto.js';
import { Invitacion } from '../invitaciones/entities/invitacion.entity.js';
import { InvitacionesService } from '../invitaciones/invitaciones.service.js';
import { InvitacionPersistenciaService } from '../invitaciones/invitacion-persistencia.service.js';
import { CreateInvitacionDto } from '../invitaciones/dto/create-invitacion.dto.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { CreatePostulaciones20261002080000 } from './migrations/20261002080000-CreatePostulaciones.js';
import { NotificacionesPersistenciaService } from '../notificaciones/notificaciones-persistencia.service.js';
import { CreateTutoresPropuestos20261002090000 } from './migrations/20261002090000-CreateTutoresPropuestos.js';
import { CreateAsignacionesTema20261002110000 } from './migrations/20261002110000-CreateAsignacionesTema.js';
import { AsignacionTema } from '../asignaciones-tema/entities/asignacion-tema.entity.js';
import { CreateGruposInvitaciones20261002060000 } from './migrations/20261002060000-CreateGruposInvitaciones.js';
import { GroupIntegrityLifecycle20261002070000 } from './migrations/20261002070000-GroupIntegrityLifecycle.js';
import { CreateUsuario20261002000000 } from './migrations/20261002000000-CreateUsuario.js';
import { CreateEstudianteDocente20261002010000 } from './migrations/20261002010000-CreateEstudianteDocente.js';
import { CreatePeriodoTitulacion20261002020000 } from './migrations/20261002020000-CreatePeriodoTitulacion.js';
import { CreateHabilitados20261002030000 } from './migrations/20261002030000-CreateHabilitados.js';
import { CreateLineaInvestigacion20261002040000 } from './migrations/20261002040000-CreateLineaInvestigacion.js';
import { CreateTemas20261002050000 } from './migrations/20261002050000-CreateTemas.js';
import { Tema } from '../temas/entities/tema.entity.js';
import { TemaHistorial } from '../temas/entities/tema-historial.entity.js';
import { EstadoTema } from '../temas/enums/estado-tema.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CreatePostulacionDto } from '../postulaciones/dto/create-postulacion.dto.js';
import { CancelarPostulacionDto } from '../postulaciones/dto/cancelar-postulacion.dto.js';
import { Postulacion } from '../postulaciones/entities/postulacion.entity.js';
import { TutorPropuesto } from '../postulaciones/entities/tutor-propuesto.entity.js';
import { ModalidadPostulacion } from '../postulaciones/enums/modalidad-postulacion.enum.js';
import { EstadoPostulacion } from '../postulaciones/enums/estado-postulacion.enum.js';
import { PostulacionPersistenciaService } from '../postulaciones/postulacion-persistencia.service.js';
import { PostulacionesService } from '../postulaciones/postulaciones.service.js';
import { TutoresPropuestosService } from '../postulaciones/tutores-propuestos.service.js';
import { TemasService } from '../temas/temas.service.js';
import { loadEnvironment } from '../config/load-environment.js';
import { createDatabaseOptions } from './database.options.js';
import { DatabaseDataSource } from './database-data-source.js';

const schema = `test_postulaciones_${randomBytes(8).toString('hex')}`;
const notifications = { invitacion: async () => undefined, postulacion: async () => undefined, asignacionTema: async () => undefined, tutor: async () => undefined, ingreso: async () => undefined } as unknown as NotificacionesPersistenciaService;
let admin: DatabaseDataSource | undefined;
let isolated: DatabaseDataSource | undefined;
let createdSchema = false;
let step = 'conexión y migraciones';

function schemaSql(): string {
  if (!/^test_postulaciones_[a-f0-9]{16}$/.test(schema)) throw new Error('El esquema temporal no es válido.');
  return `"${schema}"`;
}
function code(error: unknown): string | undefined {
  return error instanceof QueryFailedError ? (error.driverError as { code?: string }).code : undefined;
}

async function verify(): Promise<void> {
  const options = createDatabaseOptions(loadEnvironment());
  admin = new DatabaseDataSource({ ...options, schema: 'public', entities: [], migrations: [] });
  await admin.initialize();
  await admin.query(`CREATE SCHEMA ${schemaSql()}`);
  createdSchema = true;
  isolated = new DatabaseDataSource({ ...options, schema, entities: [Usuario, Estudiante, Docente, PeriodoTitulacion, EstudianteHabilitado, LoteImportacion, Auditoria, LineaInvestigacion, Tema, Grupo, GrupoIntegrante, Invitacion, Postulacion, TutorPropuesto, AsignacionTema], migrations: [CreateUsuario20261002000000, CreateEstudianteDocente20261002010000, CreatePeriodoTitulacion20261002020000, CreateHabilitados20261002030000, CreateLineaInvestigacion20261002040000, CreateTemas20261002050000, CreateGruposInvitaciones20261002060000, GroupIntegrityLifecycle20261002070000, CreatePostulaciones20261002080000, CreateTutoresPropuestos20261002090000, CreateAsignacionesTema20261002110000] });
  await isolated.initialize();
  await isolated.runMigrations({ transaction: 'all' });

  step = 'preparación de identidades elegibles';
  const userRepo = isolated.getRepository(Usuario);
  await userRepo.save(userRepo.create({ email: 'admin@postulaciones.verify', nombres: 'Admin', apellidos: 'Verificador', rol: UsuarioRol.ADMIN, estado: UsuarioEstado.ACTIVO, id_externo_sso: 'postulaciones-admin', ultimo_acceso: null }));
  const teacherUser = await userRepo.save(userRepo.create({ email: 'docente@postulaciones.verify', nombres: 'Docente', apellidos: 'Proponente', rol: UsuarioRol.DOCENTE, estado: UsuarioEstado.ACTIVO, id_externo_sso: 'postulaciones-docente', ultimo_acceso: null }));
  const teacherRepo = isolated.getRepository(Docente);
  const teacher = await teacherRepo.save(teacherRepo.create({ usuario: teacherUser, cedula: '0102030400', titulo_academico: 'Magíster', departamento: 'Sistemas', habilitado_tutoria: true }));
  const secondTeacherUser = await userRepo.save(userRepo.create({ email: 'docente2@postulaciones.verify', nombres: 'Docente 2', apellidos: 'Alternativo', rol: UsuarioRol.DOCENTE, estado: UsuarioEstado.ACTIVO, id_externo_sso: 'postulaciones-docente-2', ultimo_acceso: null }));
  const secondTeacher = await teacherRepo.save(teacherRepo.create({ usuario: secondTeacherUser, cedula: '0102030400'.replace('0400', '0418'), titulo_academico: 'Doctor', departamento: 'Sistemas', habilitado_tutoria: true }));
  const disabledTeacherUser = await userRepo.save(userRepo.create({ email: 'docente3@postulaciones.verify', nombres: 'Docente 3', apellidos: 'No habilitado', rol: UsuarioRol.DOCENTE, estado: UsuarioEstado.ACTIVO, id_externo_sso: 'postulaciones-docente-3', ultimo_acceso: null }));
  const disabledTeacher = await teacherRepo.save(teacherRepo.create({ usuario: disabledTeacherUser, cedula: '0102030426', titulo_academico: 'Magíster', departamento: 'Sistemas', habilitado_tutoria: false }));
  const studentRepo = isolated.getRepository(Estudiante);
  const studentUsers: Usuario[] = [];
  const students: Estudiante[] = [];
  for (let index = 0; index < 5; index++) {
    const account = await userRepo.save(userRepo.create({ email: `estudiante${index}@postulaciones.verify`, nombres: `Estudiante ${index}`, apellidos: 'Verificación', rol: UsuarioRol.ESTUDIANTE, estado: UsuarioEstado.ACTIVO, id_externo_sso: `postulaciones-student-${index}`, ultimo_acceso: null }));
    studentUsers.push(account);
    students.push(await studentRepo.save(studentRepo.create({ usuario: account, cedula: ['0102030418', '0102030426', '0102030434', '0102030442', '0102030459'][index]!, matricula: `POST-${index}`, carrera: 'Sistemas', nivel: 8 })));
  }
  const now = new Date();
  const periodRepo = isolated.getRepository(PeriodoTitulacion);
  const period = await periodRepo.save(periodRepo.create({ codigo: 'POST-VERIFY', nombre: 'Verificación de postulaciones', fecha_inicio_postulacion: new Date(now.getTime() - 60_000), fecha_fin_postulacion: new Date(now.getTime() + 600_000), fecha_inicio_titulacion: new Date(now.getTime() + 700_000), estado: PeriodoEstado.POSTULACION_ABIERTA, max_integrantes_default: 3 }));
  const habilitadoRepo = isolated.getRepository(EstudianteHabilitado);
  for (const student of students) await habilitadoRepo.save(habilitadoRepo.create({ periodo: period, estudiante: student, origen: HabilitadoOrigen.MANUAL, lote_importacion: null, estado: HabilitadoEstado.HABILITADO, condicion_ingreso: CondicionIngreso.CONDICIONADO, requisito_pendiente: 'Requisito de verificación', situacion_ingreso: SituacionIngreso.PENDIENTE, fecha_habilitacion: now, fecha_resolucion_ingreso: null, resuelto_por: null, observacion_ingreso: null }));
  const lineRepo = isolated.getRepository(LineaInvestigacion);
  const line = await lineRepo.save(lineRepo.create({ codigo: 'VERIFY', nombre: 'Verificación', descripcion: null, activa: true }));
  const topicRepo = isolated.getRepository(Tema);
  const topic = await topicRepo.save(topicRepo.create({ periodo: period, linea: line, docente_proponente: teacher, titulo: 'Tema de verificación', descripcion: 'Tema publicado de verificación', min_integrantes: 1, max_integrantes: 3, estado: EstadoTema.PUBLICADO, creado_en: now }));

  const audit = new AuditoriaService();
  const studentsService = new EstudiantesService(studentRepo, isolated);
  const assignmentPersistence = new AsignacionTemaPersistenciaService(audit, new AsignacionTutorPersistenciaService(audit), notifications);
  const habilitados = new HabilitadosService(habilitadoRepo, isolated, studentsService, audit, assignmentPersistence, notifications);
  const temasService = new TemasService(isolated.getRepository(Tema), isolated.getRepository(TemaHistorial), teacherRepo, studentRepo, habilitadoRepo, periodRepo, isolated, audit);
  const tutores = new TutoresPropuestosService(isolated.getRepository(TutorPropuesto), teacherRepo, isolated, temasService);
  const persistence = new PostulacionPersistenciaService();
  const invitePersistence = new InvitacionPersistenciaService(audit, notifications);
  const groups = new GruposService(isolated.getRepository(Grupo), isolated.getRepository(GrupoIntegrante), studentRepo, isolated, habilitados, audit, persistence);
  const groupManagement = new GrupoGestionService(isolated, groups, habilitados, audit, invitePersistence, persistence);
  const invitations = new InvitacionesService(isolated.getRepository(Invitacion), studentRepo, isolated, groups, habilitados, audit, persistence, notifications);
  const service = new PostulacionesService(isolated.getRepository(Postulacion), studentRepo, isolated.getRepository(GrupoIntegrante), isolated, habilitados, audit, invitePersistence, tutores, assignmentPersistence, notifications);

  step = 'postulación antigua sin preferencias y carga única';
  await isolated.query(`ALTER TABLE ${schemaSql()}."postulacion" DISABLE TRIGGER "TRG_postulacion_requiere_tutores"`);
  const legacy = await isolated.getRepository(Postulacion).save(isolated.getRepository(Postulacion).create({
    tema: topic, periodo: period, grupo: null, estudiante: students[3]!, num_integrantes: 1,
    registrada_por: studentUsers[3]!, estado: EstadoPostulacion.PENDIENTE, observacion: null,
  }));
  await isolated.query(`ALTER TABLE ${schemaSql()}."postulacion" ENABLE TRIGGER "TRG_postulacion_requiere_tutores"`);
  await service.completarTutores(period.id, legacy.id, studentUsers[3]!, [teacher.id, secondTeacher.id], null);
  const completionConflict = await service.completarTutores(period.id, legacy.id, studentUsers[3]!, [secondTeacher.id], null).then(() => false, (error: unknown) => error instanceof HttpException && error.getStatus() === 409);
  if (!completionConflict) throw new Error('Una postulación completada permitió reemplazar sus preferencias.');
  await service.cancel(period.id, legacy.id, studentUsers[3]!, false, { motivo: 'Liberar registro histórico de prueba' }, null);

  step = 'restricción diferida y atomicidad de postulaciones y auditoría';
  const deferredRunner = isolated.createQueryRunner();
  await deferredRunner.connect();
  await deferredRunner.startTransaction();
  let deferredRejected = false;
  try {
    await deferredRunner.query(`INSERT INTO ${schemaSql()}."postulacion" ("tema_id","periodo_id","estudiante_id","num_integrantes","registrada_por_id") VALUES ($1,$2,$3,1,$4)`, [topic.id, period.id, students[4]!.id, studentUsers[4]!.id]);
    await deferredRunner.commitTransaction();
  } catch (error: unknown) {
    deferredRejected = code(error) === '23514';
    if (deferredRunner.isTransactionActive) await deferredRunner.rollbackTransaction();
  } finally { await deferredRunner.release(); }
  if (!deferredRejected) throw new Error('PostgreSQL aceptó una nueva postulación sin tutores propuestos.');

  await isolated.query(`CREATE FUNCTION ${schemaSql()}."fallar_auditoria_tutores"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falla de auditoría de prueba' USING ERRCODE='P0001'; END $$`);
  await isolated.query(`CREATE TRIGGER "TRG_fallar_auditoria_tutores" BEFORE INSERT ON ${schemaSql()}."auditoria" FOR EACH ROW EXECUTE FUNCTION ${schemaSql()}."fallar_auditoria_tutores"()`);
  const beforeRollbackApps = await isolated.getRepository(Postulacion).countBy({ estudiante: { id: students[4]!.id } });
  const beforeRollbackPreferences = await isolated.getRepository(TutorPropuesto).count();
  const rollbackConfirmed = await service.create(period.id, studentUsers[4]!, { tema_id: topic.id, modalidad: ModalidadPostulacion.INDIVIDUAL, tutores_propuestos: [teacher.id] }, null).then(() => false, (error: unknown) => error instanceof HttpException && error.getStatus() === 503);
  await isolated.query(`DROP TRIGGER "TRG_fallar_auditoria_tutores" ON ${schemaSql()}."auditoria"`);
  await isolated.query(`DROP FUNCTION ${schemaSql()}."fallar_auditoria_tutores"()`);
  const afterRollbackApps = await isolated.getRepository(Postulacion).countBy({ estudiante: { id: students[4]!.id } });
  const afterRollbackPreferences = await isolated.getRepository(TutorPropuesto).count();
  if (!rollbackConfirmed || beforeRollbackApps !== afterRollbackApps || beforeRollbackPreferences !== afterRollbackPreferences) throw new Error('La falla simulada de auditoría dejó una postulación o preferencias parcialmente guardadas.');

  step = 'postulación individual concurrente y cancelación';
  const individualDto: CreatePostulacionDto = { tema_id: topic.id, modalidad: ModalidadPostulacion.INDIVIDUAL, tutores_propuestos: [secondTeacher.id, teacher.id] };
  step = 'catálogo de candidatos y preferencias ordenadas';
  const candidates = await tutores.disponibles(period.id, topic.id, studentUsers[0]!, { page: 1, limit: 20 });
  if (candidates.data[0]?.id !== teacher.id || candidates.data.some((candidate) => 'cedula' in candidate)) throw new Error('El catálogo no sugirió al proponente primero o expuso datos sensibles.');
  const ineligibleRejected = await service.create(period.id, studentUsers[3]!, { ...individualDto, tutores_propuestos: [disabledTeacher.id] }, null).then(() => false, (error: unknown) => error instanceof HttpException && error.getStatus() === 409);
  if (!ineligibleRejected) throw new Error('El servicio permitió proponer un docente no habilitado.');
  individualDto.tutores_propuestos = [teacher.id, secondTeacher.id];
  const parallel = await Promise.allSettled([service.create(period.id, studentUsers[0]!, individualDto, null), service.create(period.id, studentUsers[0]!, individualDto, null)]);
  if (parallel.filter((result) => result.status === 'fulfilled').length !== 1) throw new Error('La unicidad de postulación activa no serializó dos envíos del mismo estudiante.');
  const individual = (parallel.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof service.create>>>).value;
  const savedPreferences = await tutores.listarDePostulacion(period.id, individual.id, 1, 20);
  if (savedPreferences.data.length !== 2 || savedPreferences.data[0]?.docente_id !== teacher.id || savedPreferences.data[0]?.orden_prioridad !== 1 || !savedPreferences.data[0]?.es_proponente_tema) throw new Error('Las preferencias no conservaron orden, proponente o prioridad.');
  const immutablePreference = await isolated.getRepository(TutorPropuesto).delete(savedPreferences.data[0]!.id).then(() => false, (error: unknown) => code(error) === '23514');
  if (!immutablePreference) throw new Error('PostgreSQL permitió eliminar una preferencia histórica.');
  const individualConflict = await groups.create(period.id, studentUsers[0]!, { nombre: 'Grupo bloqueado por individual' } as CreateGrupoDto, null).then(() => false, (error: unknown) => error instanceof HttpException && error.getStatus() === 409);
  if (!individualConflict) throw new Error('Una postulación individual activa no bloqueó la creación del grupo.');
  await service.cancel(period.id, individual.id, studentUsers[0]!, false, { motivo: 'Prueba de cancelación' } as CancelarPostulacionDto, null);
  if ((await isolated.getRepository(Postulacion).findOneByOrFail({ id: individual.id })).estado !== EstadoPostulacion.CANCELADA) throw new Error('La cancelación no conservó el registro histórico.');

  step = 'formación de grupo, invitación y postulación grupal';
  const group = await groups.create(period.id, studentUsers[0]!, { nombre: 'Grupo de aplicación' } as CreateGrupoDto, null);
  const invitation = await invitations.create(period.id, group.id, studentUsers[0]!, { estudiante_destino_id: students[1]!.id } as CreateInvitacionDto, null);
  await invitations.accept(period.id, invitation.id, studentUsers[1]!, null);
  const invitationDuringPost = await invitations.create(period.id, group.id, studentUsers[0]!, { estudiante_destino_id: students[3]!.id } as CreateInvitacionDto, null);
  const groupAndAcceptRace = await Promise.allSettled([
    service.create(period.id, studentUsers[0]!, { tema_id: topic.id, modalidad: ModalidadPostulacion.GRUPAL, tutores_propuestos: [teacher.id] }, null),
    invitations.accept(period.id, invitationDuringPost.id, studentUsers[3]!, null),
  ]);
  const groupApplicationResult = groupAndAcceptRace[0];
  const concurrentAcceptResult = groupAndAcceptRace[1];
  if (groupApplicationResult.status !== 'fulfilled') throw new Error('La postulación grupal no pudo completarse en la carrera con aceptación.');
  const groupApplication = groupApplicationResult.value;
  if (groupApplication.num_integrantes !== groupApplication.participantes.length || ![2, 3].includes(groupApplication.num_integrantes)) throw new Error('La postulación grupal no registró la composición real del grupo.');
  if (concurrentAcceptResult.status === 'fulfilled' && groupApplication.num_integrantes !== 3) throw new Error('La aceptación y postulación concurrentes dejaron una composición distinta a la registrada.');
  if (concurrentAcceptResult.status === 'rejected' && groupApplication.num_integrantes !== 2) throw new Error('La composición registrada no corresponde al orden serializado de aceptación/postulación.');
  if (!(await persistence.grupoTienePostulaciones(isolated.manager, group.id))) throw new Error('La primera postulación no cerró la composición del grupo.');
  const inviteBlocked = await invitations.create(period.id, group.id, studentUsers[0]!, { estudiante_destino_id: students[0]!.id }, null).then(() => false, (error: unknown) => error instanceof HttpException && error.getStatus() === 409);
  if (!inviteBlocked) throw new Error('El grupo permitió invitar después de cerrar su composición.');
  const cancelledGroupApplication = await service.cancel(period.id, groupApplication.id, studentUsers[0]!, false, { motivo: 'Ajuste de preferencias' }, null);
  if (cancelledGroupApplication.estado !== EstadoPostulacion.CANCELADA) throw new Error('No se pudo cancelar la postulación grupal pendiente.');
  const groupRetry = await service.create(period.id, studentUsers[0]!, { tema_id: topic.id, modalidad: ModalidadPostulacion.GRUPAL, tutores_propuestos: [teacher.id] }, null);
  if (groupRetry.estado !== EstadoPostulacion.PENDIENTE) throw new Error('El grupo no pudo volver a postular después de cancelar, conservando su composición.');

  step = 'carrera entre postulación individual y aceptación de invitación';
  const otherGroup = await groups.create(period.id, studentUsers[2]!, { nombre: 'Grupo para carrera de pertenencia' } as CreateGrupoDto, null);
  const raceInvitation = await invitations.create(period.id, otherGroup.id, studentUsers[2]!, { estudiante_destino_id: students[4]!.id } as CreateInvitacionDto, null);
  const membershipRace = await Promise.allSettled([
    service.create(period.id, studentUsers[4]!, individualDto, null),
    invitations.accept(period.id, raceInvitation.id, studentUsers[4]!, null),
  ]);
  if (membershipRace.filter((result) => result.status === 'fulfilled').length !== 1) throw new Error('La carrera entre postulación individual y aceptación de invitación permitió dos resultados o ninguno.');
  const racedApplication = membershipRace.find((result) => result.status === 'fulfilled' && 'num_integrantes' in result.value) as PromiseFulfilledResult<Awaited<ReturnType<typeof service.create>>> | undefined;
  if (racedApplication) {
    await service.cancel(period.id, racedApplication.value.id, studentUsers[4]!, false, { motivo: 'Liberar para terminar verificación' }, null);
    await invitations.accept(period.id, raceInvitation.id, studentUsers[4]!, null);
  }

  step = 'carrera entre postulación grupal y salida voluntaria';
  const groupExitRace = await Promise.allSettled([
    service.create(period.id, studentUsers[2]!, { tema_id: topic.id, modalidad: ModalidadPostulacion.GRUPAL, tutores_propuestos: [teacher.id] }, null),
    groupManagement.salir(period.id, otherGroup.id, studentUsers[4]!, { motivo: 'Carrera con postulación' }, null),
  ]);
  if (groupExitRace.filter((result) => result.status === 'fulfilled').length !== 1) throw new Error('La carrera entre postulación grupal y salida cambió la composición simultáneamente o rechazó ambas operaciones.');

  step = 'protección de cambios de composición a nivel de PostgreSQL';
  const membershipMutation = await isolated.query(`UPDATE ${schemaSql()}."grupo_integrante" SET "estado"='RETIRADO', "fecha_salida"=CURRENT_TIMESTAMP, "motivo_salida"='verificación' WHERE "grupo_id"=$1 AND "estudiante_id"=$2`, [group.id, students[1]!.id]).then(() => false, (error: unknown) => code(error) === '23514');
  if (!membershipMutation) throw new Error('El trigger permitió modificar integrantes tras una postulación.');
  const outsideRange = await isolated.query(`INSERT INTO ${schemaSql()}."postulacion" ("tema_id","periodo_id","estudiante_id","num_integrantes","registrada_por_id") VALUES ($1,$2,$3,2,$4)`, [topic.id, period.id, students[0]!.id, studentUsers[0]!.id]).then(() => false, (error: unknown) => code(error) === '23505' || code(error) === '23514');
  if (!outsideRange) throw new Error('Una inserción incompatible evadió las restricciones de postulaciones.');

  step = 'reversión protegida y auditoría';
  const auditCount = await isolated.getRepository(Auditoria).count();
  if (auditCount < 5) throw new Error('Faltan auditorías de altas/cancelaciones de postulaciones e invitaciones.');
  const migration = new CreateTutoresPropuestos20261002090000();
  const revertRunner = isolated.createQueryRunner();
  await revertRunner.connect(); await revertRunner.startTransaction();
  const revertRejected = await migration.down(revertRunner).then(() => false, async (error: unknown) => { await revertRunner.rollbackTransaction(); return error instanceof Error && error.message.includes('contiene registros'); });
  if (revertRunner.isTransactionActive) await revertRunner.rollbackTransaction(); await revertRunner.release();
  if (!revertRejected) throw new Error('La migración permitió eliminar postulaciones con historial.');
  console.log('Verificación de postulaciones y tutores correcta: preferencias atómicas, concurrencia individual, cancelación histórica, integración de grupos/invitaciones, composición congelada, restricciones de tutores y reversión protegida.');
}

try { await verify(); }
catch (error: unknown) {
  const detail = error instanceof HttpException ? `${error.getStatus()} ${error.message}` : error instanceof Error ? error.message : 'error no especificado';
  console.error(`Falló la verificación de postulaciones durante: ${step}. ${detail}`); process.exitCode = 1;
}
finally {
  if (isolated?.isInitialized) await isolated.destroy().catch(() => undefined);
  if (admin?.isInitialized && createdSchema) await admin.query(`DROP SCHEMA IF EXISTS ${schemaSql()} CASCADE`).catch(() => undefined);
  if (admin?.isInitialized) await admin.destroy().catch(() => undefined);
}
