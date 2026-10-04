import { randomBytes } from 'node:crypto';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { Auditoria } from '../auditoria/entities/auditoria.entity.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { EstudianteHabilitado } from '../habilitados/entities/estudiante-habilitado.entity.js';
import { LoteImportacion } from '../importaciones/entities/lote-importacion.entity.js';
import { LineaInvestigacion } from '../lineas-investigacion/entities/linea-investigacion.entity.js';
import { CreateLineaInvestigacion20261002040000 } from './migrations/20261002040000-CreateLineaInvestigacion.js';
import { CreateEstudianteDocente20261002010000 } from './migrations/20261002010000-CreateEstudianteDocente.js';
import { CreateHabilitados20261002030000 } from './migrations/20261002030000-CreateHabilitados.js';
import { CreatePeriodoTitulacion20261002020000 } from './migrations/20261002020000-CreatePeriodoTitulacion.js';
import { CreateTemas20261002050000 } from './migrations/20261002050000-CreateTemas.js';
import { CreateUsuario20261002000000 } from './migrations/20261002000000-CreateUsuario.js';
import { loadEnvironment } from '../config/load-environment.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { CreateTemaDto } from '../temas/dto/create-tema.dto.js';
import { UpdateTemaDto } from '../temas/dto/update-tema.dto.js';
import { TemaHistorial } from '../temas/entities/tema-historial.entity.js';
import { Tema } from '../temas/entities/tema.entity.js';
import { EstadoTema } from '../temas/enums/estado-tema.enum.js';
import { TemasService } from '../temas/temas.service.js';
import { PeriodosService } from '../periodos/periodos.service.js';
import type { AbrirPostulacionDto } from '../periodos/dto/abrir-postulacion.dto.js';
import type { PublicarTemaDto } from '../temas/dto/publicar-tema.dto.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { createDatabaseOptions } from './database.options.js';
import { DatabaseDataSource } from './database-data-source.js';

const schema = `test_temas_${randomBytes(8).toString('hex')}`;
let admin: DatabaseDataSource | undefined;
let isolated: DatabaseDataSource | undefined;
let createdSchema = false;
let step = 'conexión y migraciones';

function schemaSql(): string {
  if (!/^test_temas_[a-f0-9]{16}$/.test(schema)) throw new Error('El esquema temporal no es válido.');
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
    entities: [Usuario, Estudiante, Docente, PeriodoTitulacion, EstudianteHabilitado, LoteImportacion, Auditoria, LineaInvestigacion, Tema, TemaHistorial],
    migrations: [CreateUsuario20261002000000, CreateEstudianteDocente20261002010000, CreatePeriodoTitulacion20261002020000, CreateHabilitados20261002030000, CreateLineaInvestigacion20261002040000, CreateTemas20261002050000],
  });
  await isolated.initialize();
  await isolated.runMigrations({ transaction: 'all' });

  const users = isolated.getRepository(Usuario);
  const actor = await users.save(users.create({ email: 'admin@temas.verify', nombres: 'Admin', apellidos: 'Verificación', rol: UsuarioRol.ADMIN, estado: UsuarioEstado.ACTIVO, id_externo_sso: 'temas-admin', ultimo_acceso: null }));
  const docenteUser = await users.save(users.create({ email: 'docente@temas.verify', nombres: 'Docente', apellidos: 'Proponente', rol: UsuarioRol.DOCENTE, estado: UsuarioEstado.ACTIVO, id_externo_sso: 'temas-docente', ultimo_acceso: null }));
  const docentes = isolated.getRepository(Docente);
  const docente = await docentes.save(docentes.create({ usuario: docenteUser, cedula: '0102030400', titulo_academico: 'Magíster', departamento: 'Sistemas', habilitado_tutoria: false }));
  const lineas = isolated.getRepository(LineaInvestigacion);
  const linea = await lineas.save(lineas.create({ codigo: 'IA', nombre: 'Inteligencia artificial', descripcion: null, activa: true }));
  const periodos = isolated.getRepository(PeriodoTitulacion);
  const periodo = await periodos.save(periodos.create({ codigo: 'TEMAS-VERIFY', nombre: 'Verificación temas', fecha_inicio_postulacion: new Date('2026-11-02T13:00:00Z'), fecha_fin_postulacion: new Date('2026-12-01T04:59:00Z'), fecha_inicio_titulacion: new Date('2026-12-01T13:00:00Z'), estado: PeriodoEstado.BORRADOR, max_integrantes_default: 5 }));
  const auditoria = new AuditoriaService();
  const service = new TemasService(
    isolated.getRepository(Tema), isolated.getRepository(TemaHistorial), docentes,
    isolated.getRepository(Estudiante), isolated.getRepository(EstudianteHabilitado),
    isolated.getRepository(PeriodoTitulacion), isolated, auditoria,
  );
  const periodosService = new PeriodosService(periodos, isolated, auditoria);
  const dto = { linea_id: linea.id, docente_proponente_id: docente.id, titulo: '  Sistema inteligente  ', descripcion: '  Descripción de verificación  ', min_integrantes: 1, max_integrantes: 3 } as CreateTemaDto;

  step = 'alta e historial inicial';
  const created = await service.create(periodo.id, dto, actor, null);
  if (created.estado !== 'BORRADOR' || created.titulo !== 'Sistema inteligente') throw new Error('El borrador no se creó normalizado.');
  if (await isolated.getRepository(TemaHistorial).count() !== 1 || await isolated.getRepository(Auditoria).count() !== 1) throw new Error('La creación no registró historial y auditoría.');

  step = 'edición e historial';
  const beforeNoOp = await isolated.getRepository(TemaHistorial).count();
  await service.update(periodo.id, created.id, { titulo: 'Sistema inteligente' } as UpdateTemaDto, actor, null);
  if (await isolated.getRepository(TemaHistorial).count() !== beforeNoOp) throw new Error('La edición sin cambios añadió historial.');
  await service.update(periodo.id, created.id, { max_integrantes: 4 } as UpdateTemaDto, actor, '127.0.0.1');
  if (await isolated.getRepository(TemaHistorial).count() !== 2 || await isolated.getRepository(Auditoria).count() !== 2) throw new Error('La edición no fue trazable.');

  step = 'apertura y publicación concurrentes';
  const now = Date.now();
  periodo.fecha_inicio_postulacion = new Date(now - 60_000);
  periodo.fecha_fin_postulacion = new Date(now + 5 * 60_000);
  periodo.fecha_inicio_titulacion = new Date(now + 10 * 60_000);
  await periodos.save(periodo);
  const openingAuditCount = await isolated.getRepository(Auditoria).count();
  const openFailFn = `${schemaSql()}."rechazar_auditoria_apertura"`;
  const auditTable = `${schemaSql()}."auditoria"`;
  await isolated.query(`CREATE FUNCTION ${openFailFn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo de auditoría'; END; $$`);
  await isolated.query(`CREATE TRIGGER "TRG_verify_open_audit_failure" BEFORE INSERT ON ${auditTable} FOR EACH ROW EXECUTE FUNCTION ${openFailFn}()`);
  let openControlled = false;
  try { await periodosService.abrirPostulacion(periodo.id, {} as AbrirPostulacionDto, actor, null); } catch (error: unknown) { openControlled = error instanceof ServiceUnavailableException; }
  await isolated.query(`DROP TRIGGER "TRG_verify_open_audit_failure" ON ${auditTable}`);
  await isolated.query(`DROP FUNCTION ${openFailFn}()`);
  if (!openControlled || (await periodos.findOneBy({ id: periodo.id }))?.estado !== PeriodoEstado.BORRADOR || await isolated.getRepository(Auditoria).count() !== openingAuditCount) {
    throw new Error('La apertura dejó el período actualizado sin su auditoría.');
  }
  const abrir = () => periodosService.abrirPostulacion(periodo.id, {} as AbrirPostulacionDto, actor, null);
  const aperturas = await Promise.allSettled([abrir(), abrir()]);
  if (aperturas.filter((result) => result.status === 'fulfilled').length !== 1 || (await periodos.findOneBy({ id: periodo.id }))?.estado !== PeriodoEstado.POSTULACION_ABIERTA) {
    throw new Error('La apertura concurrente no produjo una sola transición exitosa.');
  }
  const publicar = () => service.publish(periodo.id, created.id, {} as PublicarTemaDto, actor, null);
  const publicaciones = await Promise.allSettled([publicar(), publicar()]);
  if (publicaciones.filter((result) => result.status === 'fulfilled').length !== 1) throw new Error('La publicación concurrente produjo más de una transición exitosa.');
  if ((await isolated.getRepository(Tema).findOneBy({ id: created.id }))?.estado !== EstadoTema.PUBLICADO) throw new Error('El tema no quedó publicado.');
  const publishHistory = await isolated.getRepository(TemaHistorial).findOne({ where: { tema: { id: created.id }, estado_nuevo: EstadoTema.PUBLICADO } });
  if (publishHistory?.estado_anterior !== EstadoTema.BORRADOR) throw new Error('El historial de publicación no conservó BORRADOR como estado anterior.');

  step = 'publicación atómica de estado, historial y auditoría';
  const secondDraft = await service.create(periodo.id, dto, actor, null);
  const historyBeforeFailedPublish = await isolated.getRepository(TemaHistorial).count();
  const auditsBeforeFailedPublish = await isolated.getRepository(Auditoria).count();
  const publishFailFn = `${schemaSql()}."rechazar_auditoria_publicacion"`;
  await isolated.query(`CREATE FUNCTION ${publishFailFn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo de auditoría'; END; $$`);
  await isolated.query(`CREATE TRIGGER "TRG_verify_publication_audit_failure" BEFORE INSERT ON ${auditTable} FOR EACH ROW EXECUTE FUNCTION ${publishFailFn}()`);
  let publishControlled = false;
  try { await service.publish(periodo.id, secondDraft.id, {} as PublicarTemaDto, actor, null); } catch (error: unknown) { publishControlled = error instanceof ServiceUnavailableException; }
  await isolated.query(`DROP TRIGGER "TRG_verify_publication_audit_failure" ON ${auditTable}`);
  await isolated.query(`DROP FUNCTION ${publishFailFn}()`);
  if (!publishControlled || (await isolated.getRepository(Tema).findOneBy({ id: secondDraft.id }))?.estado !== EstadoTema.BORRADOR || await isolated.getRepository(TemaHistorial).count() !== historyBeforeFailedPublish || await isolated.getRepository(Auditoria).count() !== auditsBeforeFailedPublish) {
    throw new Error('La publicación dejó estado, historial o auditoría parcialmente persistidos.');
  }

  step = 'restricciones de rango';
  let rejected = false;
  try { await isolated.query(`INSERT INTO ${schemaSql()}."tema" ("periodo_id", "linea_id", "docente_proponente_id", "titulo", "descripcion", "min_integrantes", "max_integrantes") VALUES ($1,$2,$3,'Inválido','Descripción',4,2)`, [periodo.id, linea.id, docente.id]); } catch (error: unknown) { rejected = code(error) === '23514'; }
  if (!rejected) throw new Error('PostgreSQL aceptó límites incompatibles.');

  step = 'atomicidad tema-historial-auditoría';
  const fn = `${schemaSql()}."rechazar_auditoria_temas"`;
  await isolated.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo de auditoría'; END; $$`);
  await isolated.query(`CREATE TRIGGER "TRG_verify_temas_audit_failure" BEFORE INSERT ON ${auditTable} FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
  let controlled = false;
  try { await service.create(periodo.id, { ...dto, titulo: 'No persistir' }, actor, null); } catch (error: unknown) { controlled = error instanceof ServiceUnavailableException; }
  await isolated.query(`DROP TRIGGER "TRG_verify_temas_audit_failure" ON ${auditTable}`);
  await isolated.query(`DROP FUNCTION ${fn}()`);
  if (!controlled || await isolated.getRepository(Tema).findOneBy({ titulo: 'No persistir' })) throw new Error('El tema quedó persistido sin auditoría.');

  step = 'reversión protegida';
  let protectedDown = false;
  try { await isolated.undoLastMigration(); } catch (error: unknown) { protectedDown = error instanceof Error && error.message.includes('tablas de temas contienen registros'); }
  if (!protectedDown) throw new Error('La reversión no protegió los datos de temas.');
}

async function cleanup(): Promise<void> {
  let failed = false;
  if (isolated?.isInitialized) { try { await isolated.destroy(); } catch { failed = true; } }
  if (createdSchema && admin?.isInitialized) { try { await admin.query(`DROP SCHEMA ${schemaSql()} CASCADE`); } catch { failed = true; } }
  if (admin?.isInitialized) { try { await admin.destroy(); } catch { failed = true; } }
  if (failed) throw new Error('No se pudo limpiar el esquema temporal de verificación.');
}

let verified = false;
try { await verify(); verified = true; } catch (error: unknown) {
  const cause = error instanceof HttpException ? error.cause : error;
  const detail = cause instanceof QueryFailedError ? `error PostgreSQL ${code(cause) ?? 'desconocido'}` : error instanceof Error ? error.message : 'error desconocido';
  console.error(`Falló la verificación aislada durante ${step}: ${detail}. No se modificó el esquema configurado.`);
  process.exitCode = 1;
} finally { try { await cleanup(); } catch { console.error('No se pudo limpiar el esquema temporal de verificación.'); process.exitCode = 1; } }
if (verified && process.exitCode !== 1) console.info('Migraciones, restricciones, historiales, apertura y publicación concurrentes, auditoría atómica y reversión de temas verificadas en esquema temporal.');
