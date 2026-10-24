import { randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { AsignacionTemaPersistenciaService } from '../asignaciones-tema/asignacion-tema-persistencia.service.js';
import { AsignacionTutorPersistenciaService } from '../asignaciones-tutor/asignacion-tutor-persistencia.service.js';
import { Auditoria } from '../auditoria/entities/auditoria.entity.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { EstudiantesService } from '../estudiantes/estudiantes.service.js';
import { HabilitadosService } from '../habilitados/habilitados.service.js';
import { EstudianteHabilitado } from '../habilitados/entities/estudiante-habilitado.entity.js';
import { CondicionIngreso } from '../habilitados/enums/condicion-ingreso.enum.js';
import { HabilitadoEstado } from '../habilitados/enums/habilitado-estado.enum.js';
import { HabilitadoOrigen } from '../habilitados/enums/habilitado-origen.enum.js';
import { SituacionIngreso } from '../habilitados/enums/situacion-ingreso.enum.js';
import { LoteImportacion } from '../importaciones/entities/lote-importacion.entity.js';
import { Grupo } from '../grupos/entities/grupo.entity.js';
import { GrupoIntegrante } from '../grupos/entities/grupo-integrante.entity.js';
import { GrupoEstado } from '../grupos/enums/grupo-estado.enum.js';
import { GruposService } from '../grupos/grupos.service.js';
import { GrupoGestionService } from '../grupos/grupo-gestion.service.js';
import { Invitacion } from '../invitaciones/entities/invitacion.entity.js';
import { InvitacionEstado } from '../invitaciones/enums/invitacion-estado.enum.js';
import { CreateInvitacionDto } from '../invitaciones/dto/create-invitacion.dto.js';
import { InvitacionesService } from '../invitaciones/invitaciones.service.js';
import { InvitacionPersistenciaService } from '../invitaciones/invitacion-persistencia.service.js';
import { CreateGrupoDto } from '../grupos/dto/create-grupo.dto.js';
import { CreateUsuario20261002000000 } from './migrations/20261002000000-CreateUsuario.js';
import { NotificacionesPersistenciaService } from '../notificaciones/notificaciones-persistencia.service.js';
import { CreateEstudianteDocente20261002010000 } from './migrations/20261002010000-CreateEstudianteDocente.js';
import { CreatePeriodoTitulacion20261002020000 } from './migrations/20261002020000-CreatePeriodoTitulacion.js';
import { CreateHabilitados20261002030000 } from './migrations/20261002030000-CreateHabilitados.js';
import { CreateLineaInvestigacion20261002040000 } from './migrations/20261002040000-CreateLineaInvestigacion.js';
import { CreateTemas20261002050000 } from './migrations/20261002050000-CreateTemas.js';
import { CreateGruposInvitaciones20261002060000 } from './migrations/20261002060000-CreateGruposInvitaciones.js';
import { loadEnvironment } from '../config/load-environment.js';
import { createDatabaseOptions } from './database.options.js';
import { DatabaseDataSource } from './database-data-source.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { GrupoIntegranteEstado } from '../grupos/enums/grupo-integrante-estado.enum.js';
import { GroupIntegrityLifecycle20261002070000 } from './migrations/20261002070000-GroupIntegrityLifecycle.js';
import { CreatePostulaciones20261002080000 } from './migrations/20261002080000-CreatePostulaciones.js';
import { Postulacion } from '../postulaciones/entities/postulacion.entity.js';
import { PostulacionPersistenciaService } from '../postulaciones/postulacion-persistencia.service.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { LineaInvestigacion } from '../lineas-investigacion/entities/linea-investigacion.entity.js';
import { Tema } from '../temas/entities/tema.entity.js';
import { TemaHistorial } from '../temas/entities/tema-historial.entity.js';

const schema = `test_grupos_${randomBytes(8).toString('hex')}`;
const notifications = { invitacion: async () => undefined, postulacion: async () => undefined, asignacionTema: async () => undefined, tutor: async () => undefined, ingreso: async () => undefined } as unknown as NotificacionesPersistenciaService;
let admin: DatabaseDataSource | undefined;
let isolated: DatabaseDataSource | undefined;
let createdSchema = false;
let step = 'conexión y migraciones';

function schemaSql(): string {
  if (!/^test_grupos_[a-f0-9]{16}$/.test(schema)) throw new Error('El esquema temporal de grupos no es válido.');
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
  isolated = new DatabaseDataSource({
    ...options,
    schema,
    entities: [Usuario, Estudiante, Docente, PeriodoTitulacion, EstudianteHabilitado, LoteImportacion, Auditoria, LineaInvestigacion, Tema, TemaHistorial, Grupo, GrupoIntegrante, Invitacion, Postulacion],
    migrations: [CreateUsuario20261002000000, CreateEstudianteDocente20261002010000, CreatePeriodoTitulacion20261002020000, CreateHabilitados20261002030000, CreateLineaInvestigacion20261002040000, CreateTemas20261002050000, CreateGruposInvitaciones20261002060000, GroupIntegrityLifecycle20261002070000, CreatePostulaciones20261002080000],
  });
  await isolated.initialize();
  await isolated.runMigrations({ transaction: 'all' });
  const groupStates = await isolated.query(`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = $1 AND t.typname = 'grupo_estado_enum' ORDER BY e.enumsortorder`, [schema]) as Array<{ enumlabel: string }>;
  if (groupStates.map((item) => item.enumlabel).join(',') !== 'EN_CONFORMACION,ACTIVO,DISUELTO,ANULADO') throw new Error('Los estados de grupo no coinciden con el DER corregido.');

  step = 'datos aislados de período y estudiantes';
  const users = isolated.getRepository(Usuario);
  const actor = await users.save(users.create({ email: 'admin@grupos.verify', nombres: 'Admin', apellidos: 'Verificación', rol: UsuarioRol.ADMIN, estado: UsuarioEstado.ACTIVO, id_externo_sso: 'grupos-admin', ultimo_acceso: null }));
  const profiles: Estudiante[] = [];
  for (let i = 0; i < 4; i++) {
    const user = await users.save(users.create({ email: `estudiante${i}@grupos.verify`, nombres: `Estudiante ${i}`, apellidos: 'Verificación', rol: UsuarioRol.ESTUDIANTE, estado: UsuarioEstado.ACTIVO, id_externo_sso: `grupos-student-${i}`, ultimo_acceso: null }));
    profiles.push(await isolated.getRepository(Estudiante).save(isolated.getRepository(Estudiante).create({ usuario: user, cedula: ['0102030400', '0102030418', '0102030426', '0102030434'][i], matricula: `GRUPOS-${i}`, carrera: 'Sistemas', nivel: 5 })));
  }
  const now = Date.now();
  const period = await isolated.getRepository(PeriodoTitulacion).save(isolated.getRepository(PeriodoTitulacion).create({ codigo: 'GRUPOS-VERIFY', nombre: 'Verificación grupos', fecha_inicio_postulacion: new Date(now - 60_000), fecha_fin_postulacion: new Date(now + 10 * 60_000), fecha_inicio_titulacion: new Date(now + 11 * 60_000), estado: PeriodoEstado.POSTULACION_ABIERTA, max_integrantes_default: 2 }));
  const habilitados = isolated.getRepository(EstudianteHabilitado);
  for (const student of profiles) await habilitados.save(habilitados.create({ periodo: period, estudiante: student, origen: HabilitadoOrigen.MANUAL, lote_importacion: null, estado: HabilitadoEstado.HABILITADO, condicion_ingreso: CondicionIngreso.REGULAR, requisito_pendiente: null, situacion_ingreso: SituacionIngreso.ADMITIDO, fecha_habilitacion: new Date(), fecha_resolucion_ingreso: new Date(), resuelto_por: actor, observacion_ingreso: null }));

  const audit = new AuditoriaService();
  const students = isolated.getRepository(Estudiante);
  const habilitadoService = new HabilitadosService(habilitados, isolated, new EstudiantesService(students, isolated), audit, new AsignacionTemaPersistenciaService(audit, new AsignacionTutorPersistenciaService(audit), notifications), notifications);
  const postulacionPersistence = new PostulacionPersistenciaService();
  const groupService = new GruposService(isolated.getRepository(Grupo), isolated.getRepository(GrupoIntegrante), students, isolated, habilitadoService, audit, postulacionPersistence);
  const inviteService = new InvitacionesService(isolated.getRepository(Invitacion), students, isolated, groupService, habilitadoService, audit, postulacionPersistence, notifications);
  const invitePersistence = new InvitacionPersistenciaService(audit, notifications);
  const management = new GrupoGestionService(isolated, groupService, habilitadoService, audit, invitePersistence, postulacionPersistence);
  const studentUsers = profiles.map((profile) => profile.usuario);

  step = 'creación de grupos y representante';
  const groupA = await groupService.create(period.id, studentUsers[0], { nombre: ' Grupo A ' } as CreateGrupoDto, null);
  const groupB = await groupService.create(period.id, studentUsers[2], { nombre: 'Grupo B' } as CreateGrupoDto, null);
  if (groupA.estado !== GrupoEstado.EN_CONFORMACION || groupA.representante?.id !== profiles[0].id) throw new Error('El creador no quedó como representante activo.');

  step = 'invitaciones paralelas y pertenencia única';
  const dtoForTwo = { estudiante_destino_id: profiles[1].id } as CreateInvitacionDto;
  const inviteA = await inviteService.create(period.id, groupA.id, studentUsers[0], dtoForTwo, null);
  const inviteB = await inviteService.create(period.id, groupB.id, studentUsers[2], dtoForTwo, null);
  const results = await Promise.allSettled([
    inviteService.accept(period.id, inviteA.id, studentUsers[1], null),
    inviteService.accept(period.id, inviteB.id, studentUsers[1], null),
  ]);
  if (results.filter((result) => result.status === 'fulfilled').length !== 1) throw new Error('La pertenencia única no protegió dos aceptaciones concurrentes.');
  const finalGroupA = await groupService.getById(period.id, groupA.id, actor, true);
  const finalGroupB = await groupService.getById(period.id, groupB.id, actor, true);
  if (![finalGroupA, finalGroupB].some((group) => group.estado === GrupoEstado.ACTIVO && group.integrantes.length === 2)) throw new Error('El grupo no se activó correctamente al incorporar el segundo miembro.');

  step = 'consulta y persistencia de invitaciones vencidas';
  const loserId = results[0]?.status === 'fulfilled' ? inviteB.id : inviteA.id;
  const loser = await isolated.getRepository(Invitacion).findOneByOrFail({ id: loserId });
  const pastExpiry = new Date(Math.max(loser.fecha_envio.getTime() + 1, Date.now() - 60_000));
  await isolated.query(`UPDATE ${schemaSql()}."invitacion" SET "expira_en" = $2 WHERE "id" = $1`, [loserId, pastExpiry]);
  const beforeResolve = await inviteService.listReceived(period.id, studentUsers[1], { page: 1, limit: 20, estado: InvitacionEstado.EXPIRADA });
  if (!beforeResolve.data.some((item) => item.id === loserId && item.estado === InvitacionEstado.EXPIRADA)) throw new Error('La consulta no calculó EXPIRADA antes de filtrar y paginar.');
  if ((await isolated.getRepository(Invitacion).findOneByOrFail({ id: loserId })).estado !== InvitacionEstado.PENDIENTE) throw new Error('La consulta de invitaciones vencidas modificó la base de datos.');
  period.estado = PeriodoEstado.POSTULACION_CERRADA;
  await isolated.getRepository(PeriodoTitulacion).save(period);
  const expiryConflict = await inviteService.reject(period.id, loserId, studentUsers[1], null).then(() => false, (error: unknown) => error instanceof HttpException && error.getStatus() === 409);
  if (!expiryConflict || (await isolated.getRepository(Invitacion).findOneByOrFail({ id: loserId })).estado !== InvitacionEstado.EXPIRADA) throw new Error('La resolución vencida no persistió EXPIRADA antes de responder 409.');

  step = 'límite de integrantes';
  const acceptedGroup = finalGroupA.estado === GrupoEstado.ACTIVO ? finalGroupA : finalGroupB;
  const representative = acceptedGroup.id === groupA.id ? studentUsers[0] : studentUsers[2];
  period.estado = PeriodoEstado.POSTULACION_ABIERTA;
  period.max_integrantes_default = 2;
  await isolated.getRepository(PeriodoTitulacion).save(period);
  const fullConflict = await inviteService.create(period.id, acceptedGroup.id, representative, { estudiante_destino_id: profiles[3].id }, null).then(() => false, (error: unknown) => error instanceof HttpException && error.getStatus() === 409);
  if (!fullConflict) throw new Error('El grupo aceptó una invitación después de alcanzar el límite del período.');

  step = 'cambio de representante, retiro y disolución';
  const activeGroup = await groupService.getById(period.id, acceptedGroup.id, actor, true);
  const oldRepresentativeId = activeGroup.representante?.id;
  const otherMember = activeGroup.integrantes.find((member) => member.estado === GrupoIntegranteEstado.ACTIVO && member.estudiante_id !== oldRepresentativeId);
  if (!oldRepresentativeId || !otherMember) throw new Error('No se encontraron los dos integrantes para probar el cambio de representante.');
  period.max_integrantes_default = 3;
  await isolated.getRepository(PeriodoTitulacion).save(period);
  const oldRepUser = profiles.find((profile) => profile.id === oldRepresentativeId)?.usuario;
  if (!oldRepUser) throw new Error('No se encontró la cuenta del representante de prueba.');
  await inviteService.create(period.id, activeGroup.id, oldRepUser, { estudiante_destino_id: profiles[3].id }, null);
  await management.cambiarRepresentante(period.id, activeGroup.id, actor, true, { estudiante_id: otherMember.estudiante_id, motivo: 'Prueba de transferencia' }, null);
  const transferred = await groupService.getById(period.id, activeGroup.id, actor, true);
  if (transferred.representante?.id !== otherMember.estudiante_id) throw new Error('El nuevo representante no quedó activo.');
  const pendingAfterTransfer = await isolated.getRepository(Invitacion).find({ where: { grupo: { id: activeGroup.id }, estado: InvitacionEstado.PENDIENTE } });
  if (pendingAfterTransfer.length !== 0) throw new Error('El cambio de representante no canceló las invitaciones pendientes.');

  period.estado = PeriodoEstado.POSTULACION_CERRADA;
  await isolated.getRepository(PeriodoTitulacion).save(period);
  await management.retirarIntegrante(period.id, activeGroup.id, otherMember.estudiante_id, actor, { motivo: 'Prueba administrativa', nuevo_representante_id: oldRepresentativeId }, null);
  const afterAdminRetire = await groupService.getById(period.id, activeGroup.id, actor, true);
  if (afterAdminRetire.representante?.id !== oldRepresentativeId || afterAdminRetire.estado !== GrupoEstado.EN_CONFORMACION) throw new Error('El retiro administrativo no realizó el reemplazo y la transición esperada.');
  const reentryConflict = await inviteService.create(period.id, activeGroup.id, oldRepUser, { estudiante_destino_id: otherMember.estudiante_id }, null).then(() => false, (error: unknown) => error instanceof HttpException && error.getStatus() === 409);
  if (!reentryConflict) throw new Error('El sistema permitió volver a invitar al mismo grupo a un integrante retirado.');
  await management.disolver(period.id, activeGroup.id, actor, true, { motivo: 'Prueba de disolución' }, null);
  const dissolved = await groupService.getById(period.id, activeGroup.id, actor, true);
  if (dissolved.estado !== GrupoEstado.DISUELTO || dissolved.integrantes.some((member) => member.estado === GrupoIntegranteEstado.ACTIVO)) throw new Error('La disolución no conservó el grupo sin integrantes activos.');

  step = 'salida voluntaria y reingreso a otro grupo';
  period.estado = PeriodoEstado.POSTULACION_ABIERTA;
  period.max_integrantes_default = 2;
  await isolated.getRepository(PeriodoTitulacion).save(period);
  const freshGroup = await groupService.create(period.id, oldRepUser, { nombre: 'Grupo salida voluntaria' } as CreateGrupoDto, null);
  const leftGroup = await management.salir(period.id, freshGroup.id, oldRepUser, { motivo: 'Prueba de salida' }, null);
  if (leftGroup.estado !== GrupoEstado.DISUELTO || leftGroup.integrantes[0]?.estado !== GrupoIntegranteEstado.RETIRADO) throw new Error('La salida del último integrante no disolvió el grupo y conservó su membresía.');
  const anotherGroup = await groupService.create(period.id, oldRepUser, { nombre: 'Grupo nuevo después de salir' } as CreateGrupoDto, null);
  if (!anotherGroup.id) throw new Error('Un estudiante retirado no pudo formar otro grupo.');

  step = 'concurrencia de aceptación y disolución';
  const raceInvite = await inviteService.create(period.id, anotherGroup.id, oldRepUser, { estudiante_destino_id: profiles[3].id }, null);
  const race = await Promise.allSettled([
    inviteService.accept(period.id, raceInvite.id, studentUsers[3], null),
    management.disolver(period.id, anotherGroup.id, oldRepUser, false, { motivo: 'Prueba concurrente' }, null),
  ]);
  const raceFinal = await groupService.getById(period.id, anotherGroup.id, actor, true);
  if (raceFinal.estado !== GrupoEstado.DISUELTO || raceFinal.integrantes.some((member) => member.estado === GrupoIntegranteEstado.ACTIVO)) throw new Error('La aceptación concurrente dejó un integrante activo después de disolver el grupo.');
  if (!race.some((result) => result.status === 'fulfilled')) throw new Error('Ni aceptación ni disolución concurrente pudo completar una operación válida.');

  step = 'reversión transaccional al fallar auditoría';
  const rollbackGroup = await groupService.create(period.id, studentUsers[1], { nombre: 'Grupo rollback' } as CreateGrupoDto, null);
  const failingAudit = { registrar: async () => { throw new Error('Fallo de auditoría inyectado.'); } } as unknown as AuditoriaService;
  const rollbackManagement = new GrupoGestionService(isolated, groupService, habilitadoService, failingAudit, invitePersistence, postulacionPersistence);
  const auditFailure = await rollbackManagement.disolver(period.id, rollbackGroup.id, studentUsers[1], false, { motivo: 'Forzar rollback' }, null).then(() => false, (error: unknown) => error instanceof HttpException && error.getStatus() === 503);
  const afterAuditFailure = await groupService.getById(period.id, rollbackGroup.id, actor, true);
  if (!auditFailure || afterAuditFailure.estado !== GrupoEstado.EN_CONFORMACION || afterAuditFailure.integrantes[0]?.estado !== GrupoIntegranteEstado.ACTIVO) throw new Error('El fallo de auditoría no revirtió completamente la disolución.');

  step = 'migración reversible sin pérdida de datos';
  const lifecycleMigration = new GroupIntegrityLifecycle20261002070000();
  const lifecycleRunner = isolated.createQueryRunner();
  await lifecycleRunner.connect();
  await lifecycleRunner.startTransaction();
  await lifecycleMigration.down(lifecycleRunner);
  const retained = await lifecycleRunner.query(`SELECT count(*)::int AS total FROM ${schemaSql()}."grupo_integrante"`) as Array<{ total: number }>;
  if (Number(retained[0]?.total) < 4) throw new Error('Revertir la migración de integridad alteró el historial existente.');
  await lifecycleMigration.up(lifecycleRunner);
  await lifecycleRunner.commitTransaction();
  await lifecycleRunner.release();

  step = 'protección de grupo terminado sin retiros';
  const integrityRunner = isolated.createQueryRunner();
  await integrityRunner.connect();
  await integrityRunner.startTransaction();
  await integrityRunner.query(`UPDATE ${schemaSql()}."grupo" SET "estado" = 'DISUELTO' WHERE "id" = $1`, [rollbackGroup.id]);
  const terminalWithMemberRejected = await integrityRunner.query('SET CONSTRAINTS ALL IMMEDIATE').then(() => false, (error: unknown) => code(error) === '23514');
  await integrityRunner.rollbackTransaction();
  await integrityRunner.release();
  if (!terminalWithMemberRejected) throw new Error('La restricción diferida permitió terminar un grupo con integrantes activos.');

  step = 'restricciones e historial de auditoría';
  const memberships = await isolated.getRepository(GrupoIntegrante).find({ where: { periodo: { id: period.id }, estado: GrupoIntegranteEstado.ACTIVO } });
  if (memberships.length !== 2) throw new Error('Se encontró una pertenencia inesperada después de las salidas y disoluciones.');
  const representativeRows = await isolated.query(`SELECT count(*)::int AS total FROM ${schemaSql()}."grupo_integrante" WHERE "estado" = 'ACTIVO' AND "rol_en_grupo" = 'REPRESENTANTE'` ) as Array<{ total: number }>;
  if (Number(representativeRows[0]?.total) !== 2) throw new Error('El índice de representante activo no coincide con los grupos creados.');
  const auditRows = await isolated.getRepository(Auditoria).count();
  if (auditRows < 15) throw new Error('No se registraron todas las operaciones de grupo/invitación en auditoría.');
  const duplicateMembership = await isolated.query(`INSERT INTO ${schemaSql()}."grupo_integrante" ("grupo_id", "periodo_id", "estudiante_id", "rol_en_grupo") VALUES ($1,$2,$3,'INTEGRANTE')`, [acceptedGroup.id, period.id, (acceptedGroup.id === groupA.id ? profiles[0].id : profiles[2].id)]).then(() => false, (error: unknown) => code(error) === '23505');
  if (!duplicateMembership) throw new Error('La restricción única de pertenencia activa no rechazó un estudiante duplicado.');

  step = 'reversión protegida';
  const migration = new CreateGruposInvitaciones20261002060000();
  const queryRunner = isolated.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();
  const revertRejected = await migration.down(queryRunner).then(() => false, async (error: unknown) => {
    await queryRunner.rollbackTransaction();
    return error instanceof Error && error.message.includes('contienen registros');
  });
  if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
  await queryRunner.release();
  if (!revertRejected) throw new Error('La migración permitió revertir tablas con historial existente.');
  console.log('Verificación de grupos e invitaciones correcta: migraciones, pertenencia y aceptación concurrentes, límites, salidas, cambios de representante, disolución, reingreso, atomicidad de auditoría y reversión protegida.');
}

try {
  await verify();
} catch (error: unknown) {
  const detail = error instanceof HttpException ? `${error.getStatus()} ${error.message}` : error instanceof Error ? error.message : 'error no especificado';
  console.error(`Falló la verificación de grupos e invitaciones durante: ${step}. ${detail}`);
  process.exitCode = 1;
} finally {
  if (isolated?.isInitialized) await isolated.destroy().catch(() => undefined);
  if (admin?.isInitialized && createdSchema) await admin.query(`DROP SCHEMA IF EXISTS ${schemaSql()} CASCADE`).catch(() => undefined);
  if (admin?.isInitialized) await admin.destroy().catch(() => undefined);
}
