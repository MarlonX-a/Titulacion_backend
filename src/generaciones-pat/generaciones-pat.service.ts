import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service.js';
import { ArchivoLimpiezaService } from '../almacenamiento/archivo-limpieza.service.js';
import { ArchivoPendiente } from '../almacenamiento/entities/archivo-pendiente.entity.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { AppEnvironment } from '../config/environment.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { EstudianteDatosPat } from './entities/estudiante-datos-pat.entity.js';
import { ContenidoPatEstudiante } from './entities/contenido-pat.entity.js';
import { GeneracionPat } from './entities/generacion-pat.entity.js';
import { renderizarPat, type InstantaneaPat } from './render-pat.js';
import { DOCX_CONTENT_TYPE, renderizarPatDocx } from './render-pat-docx.js';
import { ActualizarDatosPatDto, ActualizarContenidoPatDto, GenerarPatDto } from './dto/actualizar-datos-pat.dto.js';
import {
  CAMPOS_PERSONALES_PAT, DISCAPACIDADES_PAT, calcularPendientesPat, contenidoEfectivo, cursoDesdeNivel, pendientesContenido, pendientesPersonales, resolverTutorPat,
  type ContenidoEfectivoPat, type TutorPropuestoPat, type TutorResueltoPat, type TutorVigentePat,
} from './pat-pendientes.js';

export interface GeneracionJob { id: string; ciclo: number }
export type FormatoDescargaPat = 'pdf' | 'docx';

/** Clave del Word institucional de una generación: la del PDF con extensión `.docx`. */
export function rutaDocxDeGeneracion(rutaPdf: string): string {
  if (!/^generaciones-pat\/[^/]+\.pdf$/.test(rutaPdf)) throw new ServiceUnavailableException('La ruta del archivo generado no es válida.');
  return rutaPdf.replace(/\.pdf$/, '.docx');
}

/** `PAT-04-F-002-<cédula>.docx`; sin una cédula utilizable, `PAT-04-F-002.docx`. */
export function nombreArchivoDocx(instantanea: InstantaneaPat): string {
  const cedula = typeof instantanea.cedula === 'string' ? instantanea.cedula.replace(/[^0-9A-Za-z-]/g, '') : '';
  return cedula ? `PAT-04-F-002-${cedula}.docx` : 'PAT-04-F-002.docx';
}
type Source = DataSource | import('typeorm').EntityManager;

/** Una generación que sigue en PROCESANDO tras este plazo se considera atascada y vuelve a la cola. */
export const GENERACION_PAT_ATASCADA_MS = 5 * 60_000;
/** Máximo de generaciones devueltas por `GET .../pat/me/generaciones`. */
export const GENERACIONES_PAT_LISTADO_MAX = 50;

type FuenteAutomatico = 'USUARIO' | 'ESTUDIANTE' | 'ESTUDIANTE_NIVEL' | 'CARRERA' | 'FACULTAD' | 'PERIODO' | 'TEMA' | 'LINEA_INVESTIGACION' | 'ASIGNACION_TEMA' | 'PREDETERMINADO' | 'CONTENIDO_PAT';
const auto = <T>(valor: T, fuente: FuenteAutomatico) => ({ valor, fuente });

/**
 * Integrante del trabajo tal como lo ven sus compañeros: la matrícula de un estudiante importado es
 * su cédula y otros datos personales, así que solo se exponen identificador, nombres y apellidos
 * (`src/common/privacidad/visor-datos.ts`). La matrícula propia sigue en `automaticos.matricula`.
 */
export interface ParticipantePat { id: string; nombres: string; apellidos: string }

/** Datos de la asignación, el estudiante y sus registros PAT que alimentan el resumen y la generación. */
interface ContextoPat {
  nombres: string; apellidos: string; email: string; cedula: string; matricula: string; nivel: number;
  carrera: string; facultad: string; periodo_codigo: string; periodo_nombre: string; extension_pat: string | null;
  titular_id: string | null; grupo_id: string | null; titulo: string; descripcion: string; tipo_tema: string;
  linea_id: string | null; linea_codigo: string | null; linea_nombre: string | null;
  personal: Record<string, unknown>; contenido_guardado: Record<string, unknown>;
  participantes: ParticipantePat[]; tutor_vigente: TutorVigentePat | null; propuestas: TutorPropuestoPat[];
}

interface ResumenCalculado {
  contexto: ContextoPat;
  contenido: ContenidoEfectivoPat;
  tutor: TutorResueltoPat;
  pendientes: string[];
}

interface GeneracionRow {
  id: string; asignacion_tema_id: string; estudiante_id: string; version_diseno: number; ciclo: number; estado: string;
  tamano_bytes: string | null; hash_sha256: string | null; error_sanitizado: string | null;
  solicitada_en: Date; generada_en: Date | null; procesando_desde?: Date | null;
}

@Injectable()
export class GeneracionesPatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GeneracionesPatService.name);
  private timer?: NodeJS.Timeout;
  private publishing = false;
  /** `BACKGROUND_TASKS_ENABLED`: republicación periódica de generaciones EN_COLA y recuperación de atascadas. */
  private readonly tareasActivas: boolean;
  constructor(
    private readonly db: DataSource,
    @InjectRepository(EstudianteDatosPat) private readonly datosRepo: Repository<EstudianteDatosPat>,
    @InjectRepository(ContenidoPatEstudiante) private readonly contenidoRepo: Repository<ContenidoPatEstudiante>,
    @InjectRepository(GeneracionPat) private readonly generacionesRepo: Repository<GeneracionPat>,
    private readonly storage: AlmacenamientoService,
    private readonly cleanup: ArchivoLimpiezaService,
    private readonly audit: AuditoriaService,
    @InjectQueue('generaciones-pat') private readonly queue: Queue<GeneracionJob>,
    config: ConfigService<AppEnvironment, true>,
  ) { this.tareasActivas = config.get('BACKGROUND_TASKS_ENABLED', { infer: true }) === true; }

  onModuleInit(): void {
    if (!this.tareasActivas) return;
    this.timer = setInterval(() => void this.publicarPendientes(), 5000);
    this.timer.unref();
    void this.publicarPendientes();
  }

  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  async obtenerDatos(actor: Usuario) {
    const student = await this.studentFor(actor.id);
    const row = await this.datosRepo.findOneBy({ estudiante_id: student.id });
    const s = this.schema();
    const identidad = await this.db.query(`SELECT e."id",e."cedula",e."matricula",e."nivel",u."nombres",u."apellidos",u."email" AS correo_institucional,c."nombre" AS carrera,f."nombre" AS facultad FROM ${s}."estudiante" e JOIN ${s}."usuario" u ON u."id"=e."usuario_id" JOIN ${s}."carrera" c ON c."id"=e."carrera_id" JOIN ${s}."facultad" f ON f."id"=c."facultad_id" WHERE e."id"=$1`, [student.id]) as Array<Record<string, unknown>>;
    return { estudiante_id: student.id, identidad: identidad[0] ?? null, datos: row?.datos ?? {}, pendientes: pendientesPersonales(row?.datos ?? {}) };
  }

  async actualizarDatos(dto: ActualizarDatosPatDto, actor: Usuario, ip: string | null) {
    const student = await this.studentFor(actor.id);
    const saved = await this.db.transaction(async (manager) => {
      await manager.query(`SELECT "id" FROM ${this.schema()}."estudiante" WHERE "id"=$1 FOR UPDATE`, [student.id]);
      const repo = manager.getRepository(EstudianteDatosPat);
      const before = await repo.findOneBy({ estudiante_id: student.id });
      const merged = { ...before?.datos, ...dto } as Record<string, unknown>;
      const keys = Object.keys(dto).filter((key) => key !== 'discapacidades' && !['grado_discapacidad', 'otra_discapacidad'].includes(key));
      if (dto.tiene_discapacidad === false) {
        delete merged.discapacidades; delete merged.grado_discapacidad; delete merged.otra_discapacidad;
        for (const key of ['discapacidades', 'grado_discapacidad', 'otra_discapacidad']) if (!keys.includes(key)) keys.push(key);
      }
      for (const key of ['curso', 'paralelo', 'sexo', 'nacionalidad', 'estado_civil', 'certificado_votacion', 'provincia', 'canton', 'parroquia', 'correo_personal', 'celular', 'telefono_convencional', 'grado_discapacidad', 'otra_discapacidad']) if (typeof merged[key] === 'string') merged[key] = (merged[key] as string).trim();
      this.validatePersonal(merged);
      const row = await repo.save(repo.create({ estudiante_id: student.id, estudiante: student, datos: merged, actualizado_en: new Date() }));
      await this.audit.registrar(manager, { actor, accion: 'ACTUALIZAR_DATOS_PAT_ESTUDIANTE', entidad_tipo: 'estudiante_datos_pat', entidad_id: student.id, valores_anteriores: { campos: before ? Object.keys(dto).filter((k) => k in before.datos) : [] }, valores_nuevos: { campos: keys }, ip_origen: ip });
      return row;
    });
    return { estudiante_id: student.id, datos: saved.datos, pendientes: pendientesPersonales(saved.datos) };
  }

  async obtenerContenido(periodoId: string, assignmentId: string, actor: Usuario) {
    const student = await this.authorizeParticipant(periodoId, assignmentId, actor);
    const row = await this.contenidoRepo.findOneBy({ asignacion_tema_id: assignmentId, estudiante_id: student.id });
    const sugerencias = await this.sugerencias(periodoId, assignmentId);
    const contenido = row?.contenido ?? (sugerencias.problematica !== null ? { problematica: sugerencias.problematica } : {});
    return { asignacion_tema_id: assignmentId, estudiante_id: student.id, contenido, problematica_sugerida: sugerencias.problematica, pendientes: pendientesContenido(contenidoEfectivo(row?.contenido ?? {}, sugerencias)) };
  }

  async tutoresPropuestos(periodoId: string, assignmentId: string, actor: Usuario) {
    await this.authorizeParticipant(periodoId, assignmentId, actor);
    const vigente = await this.tutorVigente(this.db, assignmentId);
    if (vigente) return { tutor_vigente: vigente, data: [] };
    return { tutor_vigente: null, data: await this.propuestas(this.db, periodoId, assignmentId) };
  }

  /** Resumen del formulario PAT: valores automáticos con su fuente, editables, pendientes y tutores. */
  async resumen(periodoId: string, assignmentId: string, actor: Usuario) {
    const student = await this.authorizeParticipant(periodoId, assignmentId, actor);
    const { contexto: c, contenido, tutor, pendientes } = await this.calcular(this.db, periodoId, assignmentId, student.id, null);
    const personal = Object.fromEntries(CAMPOS_PERSONALES_PAT.filter((key) => key in c.personal).map((key) => [key, c.personal[key]]));
    const modalidadGuardada = typeof c.contenido_guardado['modalidad_academica'] === 'string' && c.contenido_guardado['modalidad_academica'].trim() !== '';
    return {
      asignacion_tema_id: assignmentId,
      estudiante_id: student.id,
      automaticos: {
        nombres: auto(c.nombres, 'USUARIO'),
        apellidos: auto(c.apellidos, 'USUARIO'),
        cedula: auto(c.cedula, 'ESTUDIANTE'),
        matricula: auto(c.matricula, 'ESTUDIANTE'),
        correo_institucional: auto(c.email, 'USUARIO'),
        carrera: auto(c.carrera, 'CARRERA'),
        facultad: auto(c.facultad, 'FACULTAD'),
        periodo: auto({ codigo: c.periodo_codigo, nombre: c.periodo_nombre }, 'PERIODO'),
        extension_pat: auto(c.extension_pat?.trim() ? c.extension_pat : null, 'PERIODO'),
        nivel: auto(c.nivel, 'ESTUDIANTE'),
        curso: auto(cursoDesdeNivel(c.nivel), 'ESTUDIANTE_NIVEL'),
        tema_titulo: auto(c.titulo, 'TEMA'),
        problematica_sugerida: auto(c.descripcion, 'TEMA'),
        linea_investigacion: auto(c.linea_id ? { id: c.linea_id, codigo: c.linea_codigo, nombre: c.linea_nombre } : null, 'LINEA_INVESTIGACION'),
        articulaciones_sugeridas: auto(this.articulacionesSugeridas(c), 'LINEA_INVESTIGACION'),
        modalidad: auto(this.modalidad(c), 'ASIGNACION_TEMA'),
        tipo_tema: auto(c.tipo_tema, 'TEMA'),
        integrantes: auto(c.participantes, 'ASIGNACION_TEMA'),
        modalidad_academica: auto(contenido.modalidad_academica, modalidadGuardada ? 'CONTENIDO_PAT' : 'PREDETERMINADO'),
        tutor,
      },
      editables: {
        personal,
        contenido: {
          problematica: contenido.problematica,
          problematica_personalizada: contenido.problematica_personalizada,
          confirma_problematica: contenido.confirma_problematica,
          articulaciones: contenido.articulaciones,
          tutor_propuesto_id: contenido.tutor_propuesto_id,
        },
      },
      pendientes,
      listo_para_generar: pendientes.length === 0,
      tutores_propuestos: c.tutor_vigente ? { tutor_vigente: c.tutor_vigente, data: [] } : { tutor_vigente: null, data: c.propuestas },
    };
  }

  async actualizarContenido(periodoId: string, assignmentId: string, dto: ActualizarContenidoPatDto, actor: Usuario, ip: string | null) {
    const student = await this.authorizeParticipant(periodoId, assignmentId, actor);
    const row = await this.db.transaction(async (manager) => {
      const schema = this.schema();
      const period = await manager.query(`SELECT "estado"::text AS estado FROM ${schema}."periodo_titulacion" WHERE "id"=$1 FOR UPDATE`, [periodoId]) as Array<{ estado: string }>;
      if (!period[0]) throw new NotFoundException('No existe el período.');
      if (!['POSTULACION_CERRADA', 'EN_CURSO'].includes(period[0].estado)) throw new ConflictException('El contenido PAT solo puede editarse con postulaciones cerradas o durante titulación.');
      await this.assignment(manager, periodoId, assignmentId, true);
      await this.authorizeParticipant(periodoId, assignmentId, actor, manager);
      if (dto.tutor_propuesto_id) await this.assertPropuestaElegible(manager, periodoId, assignmentId, dto.tutor_propuesto_id);
      const repo = manager.getRepository(ContenidoPatEstudiante);
      const before = await repo.findOneBy({ asignacion_tema_id: assignmentId, estudiante_id: student.id });
      const contenido: Record<string, unknown> = { ...before?.contenido, ...dto };
      if (dto.tutor_propuesto_id === null) delete contenido['tutor_propuesto_id'];
      const saved = await repo.save(repo.create({ asignacion_tema_id: assignmentId, estudiante_id: student.id, asignacion_tema: { id: assignmentId } as never, estudiante: student, contenido, actualizado_en: new Date() }));
      await this.audit.registrar(manager, { actor, accion: 'ACTUALIZAR_CONTENIDO_PAT', entidad_tipo: 'contenido_pat_estudiante', entidad_id: saved.id, valores_anteriores: { campos: Object.keys(dto).filter((k) => k in (before?.contenido ?? {})) }, valores_nuevos: { campos: Object.keys(dto) }, ip_origen: ip });
      return saved;
    });
    const sugerencias = await this.sugerencias(periodoId, assignmentId);
    return { asignacion_tema_id: assignmentId, estudiante_id: student.id, contenido: row.contenido, pendientes: pendientesContenido(contenidoEfectivo(row.contenido, sugerencias)) };
  }

  /** La admin genera el PAT del estudiante: la generación sigue siendo de ese estudiante. */
  solicitarParaEstudiante(periodoId: string, assignmentId: string, estudianteId: string, actor: Usuario, ip: string | null) {
    if (actor.rol !== UsuarioRol.ADMIN) throw new ForbiddenException('Solo ADMIN puede generar el PAT de un estudiante.');
    return this.solicitar(periodoId, assignmentId, {}, actor, ip, estudianteId);
  }

  async solicitar(periodoId: string, assignmentId: string, dto: GenerarPatDto, actor: Usuario, ip: string | null, estudianteObjetivo: string | null = null) {
    if (estudianteObjetivo) await this.estudianteParticipante(this.db, periodoId, assignmentId, estudianteObjetivo);
    else await this.authorizeParticipant(periodoId, assignmentId, actor);
    const requestedProposalId = dto?.tutor_propuesto_id ?? null;
    const generation = await this.db.transaction(async (manager) => {
      const s = this.schema();
      const p = await manager.query(`SELECT "estado"::text AS estado FROM ${s}."periodo_titulacion" WHERE "id"=$1 FOR UPDATE`, [periodoId]) as Array<{ estado: string }>;
      if (!p[0]) throw new NotFoundException('No existe el período.');
      if (!['POSTULACION_CERRADA', 'EN_CURSO'].includes(p[0].estado)) throw new ConflictException('El PAT solo puede generarse con postulaciones cerradas o durante titulación.');
      const assignment = await this.assignment(manager, periodoId, assignmentId, true);
      if (assignment.estado !== 'VIGENTE') throw new ConflictException('La asignación de tema ya no está vigente.');
      const freshStudent = estudianteObjetivo
        ? await this.estudianteParticipante(manager, periodoId, assignmentId, estudianteObjetivo)
        : await this.authorizeParticipant(periodoId, assignmentId, actor, manager);
      const { contexto: c, contenido, tutor, pendientes } = await this.calcular(manager, periodoId, assignmentId, freshStudent.id, requestedProposalId);
      if (pendientes.length) throw new BadRequestException({ message: 'Completa los datos obligatorios antes de generar el PAT.', pendientes });
      const snapshot = {
        asignacion_id: assignmentId, titulo: c.titulo, descripcion: c.descripcion, tipo_tema: c.tipo_tema, modalidad: this.modalidad(c),
        linea_investigacion: c.linea_id ? { id: c.linea_id, codigo: c.linea_codigo, nombre: c.linea_nombre } : null,
        periodo_codigo: c.periodo_codigo, periodo_nombre: c.periodo_nombre, extension: c.extension_pat, carrera: c.carrera, facultad: c.facultad,
        nombres: c.nombres, apellidos: c.apellidos, email: c.email, cedula: c.cedula, matricula: c.matricula, nivel: c.nivel, curso: cursoDesdeNivel(c.nivel),
        personal: c.personal, contenido, participantes: c.participantes, tutor: tutor.valor, tutor_fuente: tutor.fuente,
        tutor_propuesto_id: tutor.valor?.tutor_propuesto_id ?? null, generado_para: `${c.nombres} ${c.apellidos}`, version_diseno: 1, capturado_en: new Date().toISOString(),
      };
      const repo = manager.getRepository(GeneracionPat);
      const saved = await repo.save(repo.create({ asignacion_tema_id: assignmentId, estudiante_id: freshStudent.id, solicitada_por_id: actor.id, version_diseno: 1, ciclo: 1, instantanea: snapshot, estado: 'EN_COLA', ruta_almacenamiento: null, tamano_bytes: null, hash_sha256: null, error_sanitizado: null }));
      await this.audit.registrar(manager, { actor, accion: 'SOLICITAR_GENERACION_PAT', entidad_tipo: 'generacion_pat', entidad_id: saved.id, valores_anteriores: null, valores_nuevos: { asignacion_tema_id: assignmentId, version_diseno: 1, tutor_fuente: tutor.fuente }, ip_origen: ip });
      return saved;
    });
    await this.publicar(generation.id, generation.ciclo);
    return { id: generation.id, estado: generation.estado };
  }

  /** Generaciones propias de la asignación, de la más reciente a la más antigua. */
  async listar(periodoId: string, assignmentId: string, actor: Usuario) {
    const student = await this.authorizeParticipant(periodoId, assignmentId, actor);
    const s = this.schema();
    const rows = await this.db.query(
      `SELECT g."id",g."asignacion_tema_id",g."estudiante_id",g."version_diseno",g."ciclo",g."estado",g."tamano_bytes",g."hash_sha256",g."error_sanitizado",g."solicitada_en",g."generada_en",g."procesando_desde",d."id" AS documento_pat_id
       FROM ${s}."generacion_pat" g
       LEFT JOIN ${s}."documento_pat" d ON d."generacion_id"=g."id" AND d."origen"='GENERADO'
       WHERE g."asignacion_tema_id"=$1 AND g."estudiante_id"=$2
       ORDER BY g."solicitada_en" DESC, g."id" DESC LIMIT ${GENERACIONES_PAT_LISTADO_MAX}`,
      [assignmentId, student.id],
    ) as Array<GeneracionRow & { documento_pat_id: string | null }>;
    const total = await this.db.query(`SELECT count(*)::int AS total FROM ${s}."generacion_pat" WHERE "asignacion_tema_id"=$1 AND "estudiante_id"=$2`, [assignmentId, student.id]) as Array<{ total: number }>;
    return { data: rows.map((row) => this.response(row, row.documento_pat_id)), total: Number(total[0]?.total ?? rows.length) };
  }

  async porId(periodoId: string, assignmentId: string, id: string, actor: Usuario) {
    const row = await this.generationForStudent(periodoId, assignmentId, id, actor);
    const docs = await this.db.query(`SELECT "id" FROM ${this.schema()}."documento_pat" WHERE "generacion_id"=$1 AND "origen"='GENERADO' LIMIT 1`, [id]) as Array<{ id: string }>;
    return this.response(row, docs[0]?.id ?? null);
  }

  async descargaDeEstudiante(periodoId: string, assignmentId: string, id: string, estudianteId: string, actor: Usuario, formato: FormatoDescargaPat = 'pdf') {
    if (actor.rol !== UsuarioRol.ADMIN) throw new ForbiddenException('Solo ADMIN puede descargar el PAT de un estudiante.');
    await this.estudianteParticipante(this.db, periodoId, assignmentId, estudianteId);
    const row = await this.generacionesRepo.findOneBy({ id, asignacion_tema_id: assignmentId, estudiante_id: estudianteId });
    if (!row) throw new NotFoundException('No existe esa generación PAT.');
    return this.descarga(periodoId, assignmentId, id, actor, formato, row);
  }

  async descarga(periodoId: string, assignmentId: string, id: string, actor: Usuario, formato: FormatoDescargaPat = 'pdf', filaAjena?: GeneracionPat) {
    const row = filaAjena ?? await this.generationForStudent(periodoId, assignmentId, id, actor);
    if (row.estado !== 'LISTO' || !row.ruta_almacenamiento) throw new ConflictException('La generación todavía no está disponible.');
    if (formato === 'docx') {
      const instantanea = row.instantanea as InstantaneaPat;
      const docxKey = rutaDocxDeGeneracion(row.ruta_almacenamiento);
      // Generaciones anteriores al Word (o cuyo Word falló): se genera desde la instantánea inmutable.
      if (!(await this.storage.existsPrivate(docxKey))) await this.storage.saveAtPrivateKey(docxKey, renderizarPatDocx(instantanea), DOCX_CONTENT_TYPE);
      return { url: await this.storage.signPrivateDownload(docxKey, nombreArchivoDocx(instantanea), DOCX_CONTENT_TYPE), expira_en: new Date(Date.now() + 300_000) };
    }
    return { url: await this.storage.signPrivateDownload(row.ruta_almacenamiento, 'PAT-sin-firma.pdf', 'application/pdf'), expira_en: new Date(Date.now() + 300_000) };
  }

  async configurar(periodoId: string, extension: string, actor: Usuario, ip: string | null) {
    if (typeof extension !== 'string' || !extension.trim() || extension.trim().length > 150) throw new BadRequestException('La extensión o sede es obligatoria y admite hasta 150 caracteres.');
    try {
      await this.db.transaction(async (m) => {
        const s = this.schema();
        const p = await m.query(`SELECT "estado"::text AS estado FROM ${s}."periodo_titulacion" WHERE "id"=$1 FOR UPDATE`, [periodoId]) as Array<{ estado: string }>;
        if (!p[0]) throw new NotFoundException('No existe el período.');
        if (p[0].estado === 'ARCHIVADO') throw new ConflictException('No se puede editar un período archivado.');
        await m.query(`UPDATE ${s}."periodo_titulacion" SET "extension_pat"=$2 WHERE "id"=$1`, [periodoId, extension.trim()]);
        await this.audit.registrar(m, { actor, accion: 'CONFIGURAR_FORMATO_PAT', entidad_tipo: 'periodo_titulacion', entidad_id: periodoId, valores_anteriores: null, valores_nuevos: { extension_pat: extension.trim() }, ip_origen: ip });
      });
      return { periodo_id: periodoId, extension_pat: extension.trim() };
    } catch (e) { this.handleError(e); }
  }

  async procesar(id: string, ciclo: number) {
    const row = await this.db.transaction(async (m) => {
      const repo = m.getRepository(GeneracionPat);
      const current = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!current || current.estado !== 'EN_COLA' || current.ciclo !== ciclo) return null;
      current.estado = 'PROCESANDO';
      current.procesando_desde = new Date();
      return repo.save(current);
    });
    if (!row) return;
    const key = this.storage.createPrivateKey('generaciones-pat', 'pdf');
    const docxKey = rutaDocxDeGeneracion(key);
    await this.cleanup.registrar(null, key);
    try {
      const buffer = await renderizarPat(row.instantanea as InstantaneaPat);
      await this.storage.saveAtPrivateKey(key, buffer, 'application/pdf');
      const docxGuardado = await this.guardarDocx(row.instantanea as InstantaneaPat, docxKey);
      const stored = await this.db.transaction(async (m) => {
        const repo = m.getRepository(GeneracionPat);
        const current = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
        // Otro ciclo (reintento o recuperación por atasco) tomó la generación: este archivo queda sin referencia.
        if (!current || current.estado !== 'PROCESANDO' || current.ciclo !== ciclo) return false;
        current.estado = 'LISTO'; current.ruta_almacenamiento = key; current.tamano_bytes = String(buffer.length);
        current.hash_sha256 = createHash('sha256').update(buffer).digest('hex'); current.generada_en = new Date(); current.error_sanitizado = null;
        await repo.save(current);
        await m.getRepository(ArchivoPendiente).delete({ ruta_almacenamiento: key });
        // El Word se deriva de la ruta del PDF (misma clave con `.docx`), sin columna propia.
        if (docxGuardado) await m.getRepository(ArchivoPendiente).delete({ ruta_almacenamiento: docxKey });
        return true;
      });
      if (!stored) {
        await this.cleanup.solicitar(undefined, key);
        if (docxGuardado) await this.cleanup.solicitar(undefined, docxKey);
      }
    } catch {
      await this.generacionesRepo.update({ id, ciclo, estado: 'PROCESANDO' }, { estado: 'FALLIDO', error_sanitizado: 'No se pudo generar el archivo PAT.' });
      await this.cleanup.solicitar(undefined, key);
    }
  }

  /**
   * Genera y guarda el Word institucional junto al PDF. Es complementario: si falla, la generación sigue
   * su curso con el PDF y el Word se vuelve a generar desde la instantánea al pedir su descarga.
   */
  private async guardarDocx(instantanea: InstantaneaPat, docxKey: string): Promise<boolean> {
    let registrado = false;
    try {
      const docx = renderizarPatDocx(instantanea);
      registrado = await this.cleanup.registrar(null, docxKey);
      await this.storage.saveAtPrivateKey(docxKey, docx, DOCX_CONTENT_TYPE);
      return true;
    } catch {
      this.logger.warn('No se pudo generar el Word del PAT; se generará al solicitar su descarga.');
      if (registrado) await this.cleanup.solicitar(undefined, docxKey);
      return false;
    }
  }

  async reintentar(periodoId: string, assignmentId: string, id: string, actor: Usuario, ip: string | null) {
    const row = await this.generationForStudent(periodoId, assignmentId, id, actor);
    if (row.estado !== 'FALLIDO') throw new ConflictException('Solo se pueden reintentar generaciones fallidas.');
    const cycle = row.ciclo + 1;
    await this.db.transaction(async (m) => {
      const result = await m.getRepository(GeneracionPat).update({ id, estado: 'FALLIDO', ciclo: row.ciclo }, { estado: 'EN_COLA', ciclo: cycle, error_sanitizado: null, procesando_desde: null });
      if (!result.affected) throw new ConflictException('Otra operación cambió la generación PAT; vuelve a consultarla.');
      await this.audit.registrar(m, { actor, accion: 'REINTENTAR_GENERACION_PAT', entidad_tipo: 'generacion_pat', entidad_id: id, valores_anteriores: { estado: row.estado, ciclo: row.ciclo }, valores_nuevos: { estado: 'EN_COLA', ciclo: cycle }, ip_origen: ip });
    });
    await this.publicar(id, cycle);
    return { id, estado: 'EN_COLA' };
  }

  /**
   * Devuelve a EN_COLA, con un ciclo nuevo, las generaciones que siguen en PROCESANDO tras
   * `GENERACION_PAT_ATASCADA_MS` (worker caído a mitad). El ciclo nuevo da un jobId distinto y
   * hace que un worker tardío del ciclo anterior no pueda escribir el resultado.
   */
  async recuperarAtascadas(): Promise<Array<{ id: string; ciclo: number }>> {
    const s = this.schema();
    const rows = await this.db.query(
      `WITH recuperadas AS (
         UPDATE ${s}."generacion_pat" SET "estado"='EN_COLA', "ciclo"="ciclo"+1, "procesando_desde"=NULL, "error_sanitizado"=NULL
         WHERE "estado"='PROCESANDO' AND COALESCE("procesando_desde","solicitada_en") < CURRENT_TIMESTAMP - make_interval(secs => $1)
         RETURNING "id","ciclo"
       ) SELECT "id","ciclo" FROM recuperadas`,
      [GENERACION_PAT_ATASCADA_MS / 1000],
    ) as Array<{ id: string; ciclo: number }>;
    if (rows.length) this.logger.warn(`Se devolvieron a la cola ${rows.length} generaciones PAT atascadas en PROCESANDO.`);
    return rows;
  }

  private async publicarPendientes() {
    if (this.publishing) return;
    this.publishing = true;
    try {
      await this.recuperarAtascadas();
      const rows = await this.generacionesRepo.find({ where: { estado: 'EN_COLA' }, take: 50, order: { solicitada_en: 'ASC' } });
      for (const row of rows) await this.publicar(row.id, row.ciclo);
    } catch {
      // La próxima pasada reintentará cuando PostgreSQL y Redis estén disponibles.
    } finally { this.publishing = false; }
  }

  /**
   * Publica el trabajo del ciclo. `removeOnFail: false` conserva los fallidos para diagnóstico; como un
   * jobId repetido no se vuelve a encolar, un trabajo fallido del mismo ciclo (falló antes de cambiar
   * el estado de la fila) se retira para que la fila EN_COLA pueda procesarse.
   */
  private async publicar(id: string, ciclo: number) {
    const jobId = `pat-${id}-${ciclo}`;
    try {
      const existing = await this.queue.getJob(jobId);
      if (existing && await existing.isFailed()) await existing.remove();
      await this.queue.add('generar-pat', { id, ciclo }, { jobId, attempts: 3, backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: true, removeOnFail: false });
    } catch { /* El registro EN_COLA se publicará de nuevo desde PostgreSQL. */ }
  }

  /** Carga el contexto y calcula contenido efectivo, tutor y pendientes (resumen y generación). */
  private async calcular(source: Source, periodoId: string, assignmentId: string, studentId: string, tutorSolicitado: string | null): Promise<ResumenCalculado> {
    const contexto = await this.contexto(source, periodoId, assignmentId, studentId);
    if (tutorSolicitado) {
      if (contexto.tutor_vigente) throw new BadRequestException('El trabajo ya tiene un tutor vigente; no selecciones una propuesta.');
      if (!contexto.propuestas.some((item) => item.id === tutorSolicitado)) throw new BadRequestException('El tutor elegido no pertenece a las propuestas de esta postulación.');
    }
    const contenido = contenidoEfectivo(contexto.contenido_guardado, { problematica: contexto.descripcion, articulaciones: this.articulacionesSugeridas(contexto) });
    const tutor = resolverTutorPat(contexto.tutor_vigente, contexto.propuestas, tutorSolicitado ?? contenido.tutor_propuesto_id);
    const pendientes = calcularPendientesPat({ personal: contexto.personal, contenido, tutorResuelto: tutor.valor !== null, extensionPat: contexto.extension_pat });
    return { contexto, contenido, tutor, pendientes };
  }

  private async contexto(source: Source, periodoId: string, assignmentId: string, studentId: string): Promise<ContextoPat> {
    const s = this.schema();
    const rows = await source.query(
      `SELECT u."nombres",u."apellidos",u."email",e."cedula",e."matricula",e."nivel",c."nombre" AS carrera,f."nombre" AS facultad,
              p."codigo" AS periodo_codigo,p."nombre" AS periodo_nombre,p."extension_pat",a."estudiante_id" AS titular_id,a."grupo_id",
              t."titulo",t."descripcion",t."tipo"::text AS tipo_tema,l."id" AS linea_id,l."codigo" AS linea_codigo,l."nombre" AS linea_nombre,
              COALESCE(d."datos",'{}'::jsonb) AS personal,COALESCE(cp."contenido",'{}'::jsonb) AS contenido_guardado
       FROM ${s}."asignacion_tema" a
       JOIN ${s}."tema" t ON t."id"=a."tema_id"
       LEFT JOIN ${s}."linea_investigacion" l ON l."id"=t."linea_id"
       JOIN ${s}."periodo_titulacion" p ON p."id"=a."periodo_id"
       JOIN ${s}."estudiante" e ON e."id"=$3
       JOIN ${s}."usuario" u ON u."id"=e."usuario_id"
       JOIN ${s}."carrera" c ON c."id"=e."carrera_id"
       JOIN ${s}."facultad" f ON f."id"=c."facultad_id"
       LEFT JOIN ${s}."estudiante_datos_pat" d ON d."estudiante_id"=e."id"
       LEFT JOIN ${s}."contenido_pat_estudiante" cp ON cp."asignacion_tema_id"=a."id" AND cp."estudiante_id"=e."id"
       WHERE a."id"=$1 AND a."periodo_id"=$2`,
      [assignmentId, periodoId, studentId],
    ) as Array<Omit<ContextoPat, 'participantes' | 'tutor_vigente' | 'propuestas'>>;
    if (!rows[0]) throw new NotFoundException('No fue posible preparar la información del PAT.');
    const filasParticipantes = await source.query(`SELECT e."id",u."nombres",u."apellidos" FROM ${s}."asignacion_tema" a JOIN ${s}."estudiante" e ON (e."id"=a."estudiante_id" OR EXISTS(SELECT 1 FROM ${s}."grupo_integrante" gi WHERE gi."grupo_id"=a."grupo_id" AND gi."estudiante_id"=e."id" AND gi."estado"='ACTIVO')) JOIN ${s}."usuario" u ON u."id"=e."usuario_id" WHERE a."id"=$1 ORDER BY u."apellidos",u."nombres",e."id"`, [assignmentId]) as ParticipantePat[];
    const participantes = filasParticipantes.map(({ id, nombres, apellidos }): ParticipantePat => ({ id, nombres, apellidos }));
    const tutorVigente = await this.tutorVigente(source, assignmentId);
    const propuestas = tutorVigente ? [] : await this.propuestas(source, periodoId, assignmentId);
    return { ...rows[0], nivel: Number(rows[0].nivel), participantes, tutor_vigente: tutorVigente, propuestas };
  }

  private async tutorVigente(source: Source, assignmentId: string): Promise<TutorVigentePat | null> {
    const s = this.schema();
    const rows = await source.query(
      `SELECT d."id" AS docente_id,u."nombres",u."apellidos" FROM ${s}."asignacion_tutor" at JOIN ${s}."docente" d ON d."id"=at."docente_id" JOIN ${s}."usuario" u ON u."id"=d."usuario_id" WHERE at."asignacion_tema_id"=$1 AND at."estado"='VIGENTE'`,
      [assignmentId],
    ) as TutorVigentePat[];
    return rows[0] ?? null;
  }

  private async propuestas(source: Source, periodoId: string, assignmentId: string): Promise<TutorPropuestoPat[]> {
    const s = this.schema();
    return await source.query(
      `SELECT tp."id",tp."orden_prioridad",d."id" AS docente_id,u."nombres",u."apellidos",
              (d."habilitado_tutoria"=true AND u."estado"='ACTIVO' AND u."rol"='DOCENTE') AS elegible_actualmente,
              (d."id"=t."docente_proponente_id") AS es_proponente_tema
       FROM ${s}."asignacion_tema" a
       JOIN ${s}."tema" t ON t."id"=a."tema_id"
       JOIN ${s}."tutor_propuesto" tp ON tp."postulacion_id"=a."postulacion_id"
       JOIN ${s}."docente" d ON d."id"=tp."docente_id"
       JOIN ${s}."usuario" u ON u."id"=d."usuario_id"
       WHERE a."id"=$1 AND a."periodo_id"=$2
       ORDER BY (d."id"=t."docente_proponente_id") DESC,tp."orden_prioridad" ASC,tp."id" ASC`,
      [assignmentId, periodoId],
    ) as TutorPropuestoPat[];
  }

  private async assertPropuestaElegible(source: Source, periodoId: string, assignmentId: string, proposalId: string): Promise<void> {
    if (await this.tutorVigente(source, assignmentId)) throw new BadRequestException('El trabajo ya tiene un tutor vigente; no selecciones una propuesta.');
    if (!(await this.propuestas(source, periodoId, assignmentId)).some((item) => item.id === proposalId)) throw new BadRequestException('El tutor elegido no pertenece a las propuestas de esta postulación.');
  }

  private async sugerencias(periodoId: string, assignmentId: string) {
    const s = this.schema();
    const rows = await this.db.query(`SELECT t."descripcion",t."linea_id" FROM ${s}."asignacion_tema" a JOIN ${s}."tema" t ON t."id"=a."tema_id" WHERE a."id"=$1 AND a."periodo_id"=$2`, [assignmentId, periodoId]) as Array<{ descripcion: string; linea_id: string | null }>;
    return { problematica: rows[0]?.descripcion ?? null, articulaciones: this.articulacionesSugeridas(rows[0] ?? { linea_id: null }) };
  }

  private articulacionesSugeridas(c: { linea_id: string | null }): string[] { return c.linea_id ? ['INVESTIGACION'] : []; }
  private modalidad(c: { titular_id: string | null }): 'INDIVIDUAL' | 'GRUPAL' { return c.titular_id ? 'INDIVIDUAL' : 'GRUPAL'; }

  private async generationForStudent(periodoId:string,assignmentId:string,id:string,actor:Usuario){const student=await this.authorizeParticipant(periodoId,assignmentId,actor);const row=await this.generacionesRepo.findOneBy({id,asignacion_tema_id:assignmentId,estudiante_id:student.id});if(!row)throw new NotFoundException('No existe esa generación PAT.');return row;}
  private response(r: GeneracionRow, documentoPatId: string | null) {
    return { id: r.id, asignacion_tema_id: r.asignacion_tema_id, estudiante_id: r.estudiante_id, version_diseno: r.version_diseno, ciclo: r.ciclo, estado: r.estado, tamano_bytes: r.tamano_bytes ? Number(r.tamano_bytes) : null, hash_sha256: r.hash_sha256, solicitada_en: r.solicitada_en, procesando_desde: r.procesando_desde ?? null, generada_en: r.generada_en, error: r.estado === 'FALLIDO' ? r.error_sanitizado : null, documento_pat_id: documentoPatId };
  }
  private validatePersonal(d:Record<string,unknown>){if(d['fecha_nacimiento']!==undefined){const value=String(d['fecha_nacimiento']);if(!/^\d{4}-\d{2}-\d{2}$/.test(value)){throw new BadRequestException('fecha_nacimiento debe ser una fecha ISO válida.');}const parsed=new Date(`${value}T00:00:00Z`);if(Number.isNaN(parsed.valueOf())||parsed.toISOString().slice(0,10)!==value||parsed.getTime()>Date.now())throw new BadRequestException('fecha_nacimiento debe ser una fecha real que no esté en el futuro.');}if(d['tiene_discapacidad']===false&&(d['discapacidades']||d['grado_discapacidad']||d['otra_discapacidad']))throw new BadRequestException('No se admiten detalles de discapacidad cuando se declara que no tiene.');const allowed:readonly string[]=DISCAPACIDADES_PAT;if(Array.isArray(d['discapacidades'])&&(d['discapacidades'] as unknown[]).some(v=>typeof v!=='string'||!allowed.includes(v)))throw new BadRequestException('La selección de discapacidad incluye una categoría inválida.');if(d['correo_personal_no_aplica']===true&&d['correo_personal'])throw new BadRequestException('Indica el correo personal o marca que no aplica, no ambos.');if(d['telefono_convencional_no_aplica']===true&&d['telefono_convencional'])throw new BadRequestException('Indica el teléfono convencional o marca que no aplica, no ambos.');if(d['certificado_votacion_no_aplica']===true&&d['certificado_votacion'])throw new BadRequestException('Indica el certificado o marca que no aplica, no ambos.');}
  private async studentFor(userId:string):Promise<Estudiante>{const rows=await this.db.query(`SELECT "id" FROM ${this.schema()}."estudiante" WHERE "usuario_id"=$1`,[userId]) as Array<{id:string}>;if(!rows[0])throw new NotFoundException('No existe perfil de estudiante para la cuenta.');return this.db.getRepository(Estudiante).findOneByOrFail({id:rows[0].id});}
  private async authorizeParticipant(periodoId:string,assignmentId:string,actor:Usuario,source:Source=this.db):Promise<Estudiante>{if(actor.rol!==UsuarioRol.ESTUDIANTE)throw new ForbiddenException('Solo el estudiante titular puede gestionar su PAT.');const student=await this.studentFor(actor.id);const s=this.schema();const rows=await source.query(`SELECT 1 FROM ${s}."asignacion_tema" a WHERE a."id"=$1 AND a."periodo_id"=$2 AND a."estado"='VIGENTE' AND (a."estudiante_id"=$3 OR EXISTS(SELECT 1 FROM ${s}."grupo_integrante" gi WHERE gi."grupo_id"=a."grupo_id" AND gi."estudiante_id"=$3 AND gi."estado"='ACTIVO'))`,[assignmentId,periodoId,student.id]) as unknown[];if(!rows.length)throw new NotFoundException('No existe una asignación vigente propia.');return student;}
  private async estudianteParticipante(source:Source,periodoId:string,assignmentId:string,estudianteId:string):Promise<Estudiante>{const s=this.schema();const rows=await source.query(`SELECT 1 FROM ${s}."asignacion_tema" a WHERE a."id"=$1 AND a."periodo_id"=$2 AND a."estado"='VIGENTE' AND (a."estudiante_id"=$3 OR EXISTS(SELECT 1 FROM ${s}."grupo_integrante" gi WHERE gi."grupo_id"=a."grupo_id" AND gi."estudiante_id"=$3 AND gi."estado"='ACTIVO'))`,[assignmentId,periodoId,estudianteId]) as unknown[];if(!rows.length)throw new NotFoundException('No existe una asignación vigente de ese estudiante.');const estudiante=await source.getRepository(Estudiante).findOneBy({id:estudianteId});if(!estudiante)throw new NotFoundException('No existe el estudiante indicado.');return estudiante;}
  private async assignment(source:Source,periodoId:string,id:string,lock=false){const rows=await source.query(`SELECT "id","periodo_id","estado"::text AS estado FROM ${this.schema()}."asignacion_tema" WHERE "id"=$1 AND "periodo_id"=$2 ${lock?'FOR UPDATE':''}`,[id,periodoId]) as Array<{id:string;periodo_id:string;estado:string}>;if(!rows[0])throw new NotFoundException('No existe la asignación del período.');return rows[0];}
  private schema(){const n=(this.db.options as PostgresConnectionOptions).schema??'public';if(!/^[a-z][a-z0-9_]{0,62}$/.test(n))throw new ServiceUnavailableException('Esquema PostgreSQL inválido.');return `"${n}"`;}
  private handleError(e:unknown):never{if(e instanceof Error&&'getStatus'in e)throw e;if(e instanceof QueryFailedError){const code=(e.driverError as {code?:string}).code;if(code==='23505')throw new ConflictException('Ya existe el registro PAT solicitado.');if(['23503','23514'].includes(code??''))throw new ConflictException('La operación no cumple las reglas vigentes del PAT.');if(['40001','40P01'].includes(code??''))throw new ConflictException('Otra operación simultánea cambió el PAT; vuelve a intentarlo.');}throw new ServiceUnavailableException('No fue posible completar la operación PAT.',{cause:e});}
}
