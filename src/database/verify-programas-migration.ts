import { HttpException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { AcademicoService } from '../academico/academico.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { EstudianteHabilitado } from '../habilitados/entities/estudiante-habilitado.entity.js';
import { NotificacionesPersistenciaService } from '../notificaciones/notificaciones-persistencia.service.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { Programa } from '../programas/entities/programa.entity.js';
import { ProgramasService } from '../programas/programas.service.js';
import { TemaHistorial } from '../temas/entities/tema-historial.entity.js';
import { Tema } from '../temas/entities/tema.entity.js';
import { TipoTema } from '../temas/enums/tipo-tema.enum.js';
import { TemasService } from '../temas/temas.service.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { catalogoSembrado } from './verify-academico.js';
import { pgErrorCode as code, runTemporarySchemaVerification, undoMigrationsThrough, type TemporarySchemaContext } from './verify-temp-schema.js';

const MIGRACION = 'ProgramasCoordinador20261115110000';

/** Verifies migration 20261115110000 (programas + COORDINADOR role) and the programa services against PostgreSQL. */
await runTemporarySchemaVerification({
  prefix: 'test_programas',
  subject: 'de los programas de temas',
  cleanupSubject: 'de los programas',
  success: 'Programas de temas (rol COORDINADOR, responsable único, límite y carrera de temas, unicidad de nombre, servicios y reversión protegida) verificados en esquema temporal.',
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
  try { await promesa; return false; } catch (error: unknown) { return code(error) === esperado || (error instanceof HttpException && String(error.getStatus()) === esperado); }
}

async function verificar({ db, schema, schemaSql: s, step }: TemporarySchemaContext): Promise<void> {
  step('reversión sin datos y reaplicación');
  await undoMigrationsThrough(db, s, MIGRACION);
  const sinTabla = await db.query(`SELECT to_regclass($1) AS tabla`, [`${schema}.programa`]) as Array<{ tabla: string | null }>;
  if (sinTabla[0]?.tabla !== null) throw new Error('La reversión no eliminó la tabla programa.');
  await db.runMigrations({ transaction: 'all' });
  const roles = await db.query(`SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS valores FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND t.typname='usuario_rol_enum'`, [schema]) as Array<{ valores: string[] }>;
  if (roles[0]?.valores.join() !== 'ESTUDIANTE,DOCENTE,ADMIN,COORDINADOR') throw new Error(`Roles inesperados: ${roles[0]?.valores.join()}.`);

  step('fixtures');
  const { carreraId, facultadId } = await catalogoSembrado(db, s);
  const otra = (await db.query(`SELECT "id" FROM ${s}."carrera" WHERE "id" <> $1 ORDER BY "codigo" LIMIT 1`, [carreraId]) as Array<{ id: string }>)[0]!.id;
  const uno = async (sql: string, params: unknown[] = []): Promise<string> => ((await db.query(sql, params)) as Array<{ id: string }>)[0]!.id;
  const adminId = await uno(`INSERT INTO ${s}."usuario" ("email","nombres","apellidos","rol","estado") VALUES ('admin.prog@uleam.edu.ec','Admin','Prog','ADMIN','ACTIVO') RETURNING "id"`);
  const coordId = await uno(`INSERT INTO ${s}."usuario" ("email","nombres","apellidos","rol","estado") VALUES ('coord.prog@uleam.edu.ec','Cora','Coord','COORDINADOR','ACTIVO') RETURNING "id"`);
  const docenteUser = await uno(`INSERT INTO ${s}."usuario" ("email","nombres","apellidos","rol","estado") VALUES ('doc.prog@uleam.edu.ec','Doc','Prog','DOCENTE','ACTIVO') RETURNING "id"`);
  const docenteId = await uno(`INSERT INTO ${s}."docente" ("usuario_id","carrera_id") VALUES ($1,$2) RETURNING "id"`, [docenteUser, carreraId]);
  const lineaId = await uno(`INSERT INTO ${s}."linea_investigacion" ("codigo","nombre") VALUES ('PRG','Línea programas') RETURNING "id"`);
  const programa = (nombre: string, extra = `"responsable_usuario_id"`, valor: unknown = coordId, max = 2, carrera = carreraId) =>
    uno(`INSERT INTO ${s}."programa" ("nombre","carrera_id",${extra},"max_temas") VALUES ($1,$2,$3,$4) RETURNING "id"`, [nombre, carrera, valor, max]);

  step('restricciones del programa');
  if (!await falla(db.query(`INSERT INTO ${s}."programa" ("nombre","carrera_id") VALUES ('Sin responsable',$1)`, [carreraId]), '23514')) throw new Error('Se aceptó un programa sin responsable.');
  if (!await falla(db.query(`INSERT INTO ${s}."programa" ("nombre","carrera_id","responsable_docente_id","responsable_usuario_id") VALUES ('Dos',$1,$2,$3)`, [carreraId, docenteId, coordId]), '23514')) throw new Error('Se aceptó un programa con dos responsables.');
  if (!await falla(programa('Usuario docente', `"responsable_usuario_id"`, docenteUser), '23514')) throw new Error('Se aceptó un responsable usuario sin rol COORDINADOR.');
  if (!await falla(programa('Máximo inválido', `"responsable_usuario_id"`, coordId, 51), '23514')) throw new Error('Se aceptó max_temas fuera de 1..50.');
  const programaId = await programa('Programa IA');
  if (!await falla(programa('  programa ia '), '23505')) throw new Error('Se repitió el nombre del programa en la carrera.');
  await programa('Programa IA', `"responsable_docente_id"`, docenteId, 2, otra).catch(() => { throw new Error('El mismo nombre en otra carrera debe permitirse.'); });

  step('temas del programa: carrera y límite');
  const tema = (titulo: string, carrera = carreraId) => uno(`INSERT INTO ${s}."tema" ("carrera_id","linea_id","docente_proponente_id","titulo","descripcion","tipo","estado","programa_id","categoria") VALUES ($1,$2,$3,$4,'Descripción','INDIVIDUAL','BORRADOR',$5,'Visión') RETURNING "id"`, [carrera, lineaId, docenteId, titulo, programaId]);
  if (!await falla(tema('Otra carrera', otra), '23514')) throw new Error('Se aceptó un tema de otra carrera en el programa.');
  const t1 = await tema('Tema 1');
  await tema('Tema 2');
  if (!await falla(tema('Tema 3'), '23514')) throw new Error('Se superó max_temas del programa.');
  if (!await falla(db.query(`UPDATE ${s}."programa" SET "max_temas"=1 WHERE "id"=$1`, [programaId]), '23514')) throw new Error('Se bajó max_temas por debajo de los temas actuales.');
  await db.query(`UPDATE ${s}."tema" SET "estado"='RETIRADO' WHERE "id"=$1`, [t1]);
  await tema('Tema 3 tras retiro');
  if (!await falla(db.query(`UPDATE ${s}."programa" SET "carrera_id"=$2 WHERE "id"=$1`, [programaId, otra]), '23514')) throw new Error('Se cambió la carrera de un programa con temas.');

  step('servicios: programas y temas del COORDINADOR');
  const audit = new AuditoriaService();
  const academico = new AcademicoService();
  const programas = new ProgramasService(db.getRepository(Programa), db, audit, academico);
  const temas = new TemasService(db.getRepository(Tema), db.getRepository(TemaHistorial), db.getRepository(Docente), db.getRepository(Estudiante), db.getRepository(EstudianteHabilitado), db.getRepository(PeriodoTitulacion), db, audit, new NotificacionesPersistenciaService(db), academico, programas);
  const coordinador = await db.getRepository(Usuario).findOneByOrFail({ id: coordId });
  const admin = await db.getRepository(Usuario).findOneByOrFail({ id: adminId });
  const propio = await programas.create({ nombre: 'Programa del coordinador', carrera_id: carreraId, max_temas: 1 }, coordinador, null);
  if (propio.responsable.tipo !== 'COORDINADOR' || propio.responsable_usuario_id !== coordId || propio.temas_registrados !== 0) throw new Error(`Programa creado inesperado: ${JSON.stringify(propio)}.`);
  const alta = { carrera_id: carreraId, linea_id: lineaId, docente_proponente_id: docenteId, tipo: TipoTema.INDIVIDUAL, titulo: 'Tema del coordinador', descripcion: 'Descripción', programa_id: propio.id, categoria: 'Datos' };
  const creado = await temas.create(alta, coordinador, null);
  if (creado.programa?.id !== propio.id || creado.categoria !== 'Datos') throw new Error('El tema no quedó asociado al programa.');
  if (!await falla(temas.create({ ...alta, titulo: 'Excede el máximo' }, coordinador, null), '409')) throw new Error('El servicio permitió superar max_temas.');
  if (!await falla(temas.create({ ...alta, programa_id: programaId, titulo: 'Programa ajeno' }, (await db.getRepository(Usuario).save(db.getRepository(Usuario).create({ email: 'coord2.prog@uleam.edu.ec', nombres: 'Otro', apellidos: 'Coord', rol: 'COORDINADOR', estado: 'ACTIVO' } as never))) as unknown as Usuario, null), '403')) throw new Error('Un COORDINADOR usó un programa ajeno.');
  const filtrados = await temas.list({ page: 1, limit: 20, programa_id: propio.id } as never, admin);
  if (filtrados.total !== 1 || filtrados.data[0]?.id !== creado.id) throw new Error('El filtro programa_id de temas no funcionó.');
  const listado = await programas.list({ page: 1, limit: 20, facultad_id: facultadId, mios: true } as never, coordinador);
  const ids = new Set(listado.data.map((item) => item.id));
  if (listado.total !== 2 || !ids.has(programaId) || !ids.has(propio.id)) throw new Error(`Listado de programas inesperado: ${JSON.stringify(listado.data.map((p) => p.nombre))}.`);
  const detalle = await programas.getById(propio.id, admin);
  if (detalle.temas_registrados !== 1) throw new Error('temas_registrados no cuenta el tema del programa.');

  step('reversión protegida');
  let protegida = false;
  try { await undoMigrationsThrough(db, s, MIGRACION); }
  catch (error: unknown) { protegida = error instanceof Error && error.message.includes('No se puede revertir los programas'); }
  if (!protegida) throw new Error('La reversión no protegió los programas existentes.');
}
