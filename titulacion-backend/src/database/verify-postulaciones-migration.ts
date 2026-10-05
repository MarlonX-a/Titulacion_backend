import { randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { Auditoria } from '../auditoria/entities/auditoria.entity.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
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
import { CreateGruposInvitaciones20261002060000 } from './migrations/20261002060000-CreateGruposInvitaciones.js';
import { GroupIntegrityLifecycle20261002070000 } from './migrations/20261002070000-GroupIntegrityLifecycle.js';
import { CreateUsuario20261002000000 } from './migrations/20261002000000-CreateUsuario.js';
import { CreateEstudianteDocente20261002010000 } from './migrations/20261002010000-CreateEstudianteDocente.js';
import { CreatePeriodoTitulacion20261002020000 } from './migrations/20261002020000-CreatePeriodoTitulacion.js';
import { CreateHabilitados20261002030000 } from './migrations/20261002030000-CreateHabilitados.js';
import { CreateLineaInvestigacion20261002040000 } from './migrations/20261002040000-CreateLineaInvestigacion.js';
import { CreateTemas20261002050000 } from './migrations/20261002050000-CreateTemas.js';
import { Tema } from '../temas/entities/tema.entity.js';
import { EstadoTema } from '../temas/enums/estado-tema.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CreatePostulacionDto } from '../postulaciones/dto/create-postulacion.dto.js';
import { CancelarPostulacionDto } from '../postulaciones/dto/cancelar-postulacion.dto.js';
import { Postulacion } from '../postulaciones/entities/postulacion.entity.js';
import { ModalidadPostulacion } from '../postulaciones/enums/modalidad-postulacion.enum.js';
import { EstadoPostulacion } from '../postulaciones/enums/estado-postulacion.enum.js';
import { PostulacionPersistenciaService } from '../postulaciones/postulacion-persistencia.service.js';
import { PostulacionesService } from '../postulaciones/postulaciones.service.js';
import { loadEnvironment } from '../config/load-environment.js';
import { createDatabaseOptions } from './database.options.js';
import { DatabaseDataSource } from './database-data-source.js';

const schema = `test_postulaciones_${randomBytes(8).toString('hex')}`;
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
  isolated = new DatabaseDataSource({ ...options, schema, entities: [Usuario, Estudiante, Docente, PeriodoTitulacion, EstudianteHabilitado, LoteImportacion, Auditoria, LineaInvestigacion, Tema, Grupo, GrupoIntegrante, Invitacion, Postulacion], migrations: [CreateUsuario20261002000000, CreateEstudianteDocente20261002010000, CreatePeriodoTitulacion20261002020000, CreateHabilitados20261002030000, CreateLineaInvestigacion20261002040000, CreateTemas20261002050000, CreateGruposInvitaciones20261002060000, GroupIntegrityLifecycle20261002070000, CreatePostulaciones20261002080000] });
  await isolated.initialize();
  await isolated.runMigrations({ transaction: 'all' });

  step = 'preparación de identidades elegibles';
  const userRepo = isolated.getRepository(Usuario);
  await userRepo.save(userRepo.create({ email: 'admin@postulaciones.verify', nombres: 'Admin', apellidos: 'Verificador', rol: UsuarioRol.ADMIN, estado: UsuarioEstado.ACTIVO, id_externo_sso: 'postulaciones-admin', ultimo_acceso: null }));
  const teacherUser = await userRepo.save(userRepo.create({ email: 'docente@postulaciones.verify', nombres: 'Docente', apellidos: 'Proponente', rol: UsuarioRol.DOCENTE, estado: UsuarioEstado.ACTIVO, id_externo_sso: 'postulaciones-docente', ultimo_acceso: null }));
  const teacherRepo = isolated.getRepository(Docente);
  const teacher = await teacherRepo.save(teacherRepo.create({ usuario: teacherUser, cedula: '0102030400', titulo_academico: 'Magíster', departamento: 'Sistemas', habilitado_tutoria: false }));
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
  const habilitados = new HabilitadosService(habilitadoRepo, isolated, studentsService, audit);
  const persistence = new PostulacionPersistenciaService();
  const invitePersistence = new InvitacionPersistenciaService(audit);
  const groups = new GruposService(isolated.getRepository(Grupo), isolated.getRepository(GrupoIntegrante), studentRepo, isolated, habilitados, audit, persistence);
  const groupManagement = new GrupoGestionService(isolated, groups, habilitados, audit, invitePersistence, persistence);
  const invitations = new InvitacionesService(isolated.getRepository(Invitacion), studentRepo, isolated, groups, habilitados, audit, persistence);
  const service = new PostulacionesService(isolated.getRepository(Postulacion), studentRepo, isolated.getRepository(GrupoIntegrante), isolated, habilitados, audit, invitePersistence);

  step = 'postulación individual concurrente y cancelación';
  const individualDto: CreatePostulacionDto = { tema_id: topic.id, modalidad: ModalidadPostulacion.INDIVIDUAL };
  const parallel = await Promise.allSettled([service.create(period.id, studentUsers[0]!, individualDto, null), service.create(period.id, studentUsers[0]!, individualDto, null)]);
  if (parallel.filter((result) => result.status === 'fulfilled').length !== 1) throw new Error('La unicidad de postulación activa no serializó dos envíos del mismo estudiante.');
  const individual = (parallel.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof service.create>>>).value;
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
    service.create(period.id, studentUsers[0]!, { tema_id: topic.id, modalidad: ModalidadPostulacion.GRUPAL }, null),
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
  const groupRetry = await service.create(period.id, studentUsers[0]!, { tema_id: topic.id, modalidad: ModalidadPostulacion.GRUPAL }, null);
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
    service.create(period.id, studentUsers[2]!, { tema_id: topic.id, modalidad: ModalidadPostulacion.GRUPAL }, null),
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
  const migration = new CreatePostulaciones20261002080000();
  const runner = isolated.createQueryRunner();
  await runner.connect(); await runner.startTransaction();
  const revertRejected = await migration.down(runner).then(() => false, async (error: unknown) => { await runner.rollbackTransaction(); return error instanceof Error && error.message.includes('contiene registros'); });
  if (runner.isTransactionActive) await runner.rollbackTransaction(); await runner.release();
  if (!revertRejected) throw new Error('La migración permitió eliminar postulaciones con historial.');
  console.log('Verificación de postulaciones correcta: migraciones aisladas, concurrencia individual, cancelación histórica, integración de grupos/invitaciones, composición congelada, restricciones y reversión protegida.');
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
