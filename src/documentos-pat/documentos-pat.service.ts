import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { DataSource, In, QueryFailedError, Repository } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service.js';
import { ArchivoLimpiezaService } from '../almacenamiento/archivo-limpieza.service.js';
import { ArchivoPendiente } from '../almacenamiento/entities/archivo-pendiente.entity.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { AsignacionTemaEstado } from '../asignaciones-tema/enums/asignacion-tema-estado.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { PlantillaPat } from '../plantillas-pat/entities/plantilla-pat.entity.js';
import { validatePlantillaFile } from '../plantillas-pat/plantilla-pat-file.validator.js';
import { CargarDocumentoPatDto } from './dto/cargar-documento-pat.dto.js';
import { DocumentoPatDownloadDto, DocumentoPatResponseDto, PagedDocumentoPatResponseDto } from './dto/documento-pat-response.dto.js';
import { DocumentoPat } from './entities/documento-pat.entity.js';
import { EstadoUltimaPat, ListUltimasPatQueryDto, PagedUltimasPatResponseDto, UltimaPatParticipanteDto } from './dto/ultimas-pat-periodo.dto.js';
import { DocumentoPatFormato } from './enums/documento-pat-formato.enum.js';
import { DocumentoPatOrigen } from './enums/documento-pat-origen.enum.js';
import { RevisionPat } from '../revisiones-pat/entities/revision-pat.entity.js';
import { RevisionPatResultado } from '../revisiones-pat/enums/revision-pat-resultado.enum.js';
import { RevisionPatResponseDto } from '../revisiones-pat/dto/revision-pat-response.dto.js';
import { NotificacionesPersistenciaService } from '../notificaciones/notificaciones-persistencia.service.js';
import { GeneracionPat } from '../generaciones-pat/entities/generacion-pat.entity.js';

interface AssignmentContext {
  periodo_id: string; periodo_estado: string; asignacion_estado: string;
  estudiante_id: string | null; grupo_id: string | null; tema_id: string;
}
interface DriverError { code?: string }
const relations = { plantilla: true, cargado_por: true, revision: { revisor: true } } as const;

@Injectable()
export class DocumentosPatService {
  constructor(
    @InjectRepository(DocumentoPat) private readonly repository: Repository<DocumentoPat>,
    private readonly dataSource: DataSource,
    private readonly storage: AlmacenamientoService,
    private readonly cleanup: ArchivoLimpiezaService,
    private readonly audit: AuditoriaService,
    private readonly notificaciones: NotificacionesPersistenciaService,
  ) {}

  /** La admin entrega el PDF firmado del estudiante. El documento queda a nombre de ese estudiante. */
  cargarFirmadoDeEstudiante(periodoId: string, asignacionId: string, estudianteId: string, dto: CargarDocumentoPatDto, file: Express.Multer.File | undefined, actor: Usuario, ip: string | null): Promise<DocumentoPatResponseDto> {
    if (actor.rol !== UsuarioRol.ADMIN) throw new ForbiddenException('Solo ADMIN puede entregar el PAT firmado de un estudiante.');
    return this.cargar(periodoId, asignacionId, dto, file, actor, ip, estudianteId);
  }

  async cargar(periodoId: string, asignacionId: string, dto: CargarDocumentoPatDto, file: Express.Multer.File | undefined, actor: Usuario, ip: string | null, estudianteObjetivo: string | null = null): Promise<DocumentoPatResponseDto> {
    if (!file) throw new BadRequestException('Adjunta el archivo en el campo archivo.');
    if (estudianteObjetivo) {
      if (actor.rol !== UsuarioRol.ADMIN) throw new ForbiddenException('Solo ADMIN puede entregar el PAT firmado de un estudiante.');
    } else if (actor.rol !== UsuarioRol.ESTUDIANTE) throw new ForbiddenException('Solo el estudiante titular o integrante puede entregar su PAT individual.');
    if (!dto.generacion_id) throw new BadRequestException('Indica la generación individual a la que corresponde el PDF firmado.');
    const generationId = dto.generacion_id;
    const validated = validatePlantillaFile(file);
    if (validated.extension !== 'pdf' || file.mimetype !== 'application/pdf') throw new BadRequestException('El PAT firmado debe ser un archivo PDF.');
    const initial = await this.context(this.dataSource, periodoId, asignacionId);
    if (estudianteObjetivo) await this.exigirParticipante(this.dataSource, periodoId, asignacionId, estudianteObjetivo);
    else await this.authorizeUpload(this.dataSource, initial, actor);
    const studentId = estudianteObjetivo ?? await this.studentId(this.dataSource, actor.id);
    if (!studentId) throw new ForbiddenException('Se requiere un perfil de estudiante.');
    await this.assertGeneration(this.dataSource, asignacionId, dto.generacion_id, studentId);
    await this.assertCorrectionAllowed(this.dataSource, asignacionId, studentId);

    const key = this.storage.createPrivateKey('documentos-pat', validated.extension);
    try { await this.cleanup.registrar(periodoId, key); } catch (error: unknown) { this.handleError(error); }
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    try {
      await this.storage.saveAtPrivateKey(key, file.buffer, validated.mimeType);
      const id = await this.dataSource.transaction(async (manager) => {
        // Lock order is period, assignment, template; this matches the domain's write order.
        const period = await manager.query(
          `SELECT "estado"::text AS estado FROM ${this.schema()}."periodo_titulacion" WHERE "id"=$1 FOR UPDATE`, [periodoId],
        ) as Array<{ estado: string }>;
        if (!period[0]) throw new NotFoundException('No existe el período indicado.');
        if (!['POSTULACION_CERRADA', 'EN_CURSO'].includes(period[0].estado)) throw new ConflictException('La entrega PAT solo se permite con postulaciones cerradas o durante titulación.');
        const context = await this.context(manager, periodoId, asignacionId, true);
        if (context.asignacion_estado !== AsignacionTemaEstado.VIGENTE) throw new ConflictException('La asignación de tema ya no está vigente.');
        if (estudianteObjetivo) await this.exigirParticipante(manager, periodoId, asignacionId, estudianteObjetivo);
        else await this.authorizeUpload(manager, context, actor);
        const participantId = estudianteObjetivo ?? await this.studentId(manager, actor.id);
        if (!participantId || participantId !== studentId) throw new ForbiddenException('No se pudo validar el estudiante de la sesión.');
        const generation = await this.assertGeneration(manager, asignacionId, generationId, participantId, true);
        await this.assertCorrectionAllowed(manager, asignacionId, participantId);
        const latest = await manager.query(
          `SELECT COALESCE(MAX("version"),0)::int AS version FROM ${this.schema()}."documento_pat" WHERE "asignacion_tema_id"=$1 AND "estudiante_id"=$2`, [asignacionId, participantId],
        ) as Array<{ version: number }>;
        const version = Number(latest[0]?.version ?? 0) + 1;
        if (version > 32767) throw new ConflictException('El trabajo alcanzó el máximo de versiones PAT permitido.');
        const repo = manager.getRepository(DocumentoPat);
        const created = await repo.save(repo.create({
          asignacion_tema_id: asignacionId,
          asignacion_tema: { id: asignacionId } as never,
          plantilla_id: null,
          version,
          nombre_archivo: validated.fileName,
          ruta_almacenamiento: key,
          formato: validated.extension === 'pdf' ? DocumentoPatFormato.PDF : DocumentoPatFormato.DOCX,
          tamano_bytes: String(file.size),
          hash_sha256: hash,
          cargado_por_id: actor.id,
          cargado_por: actor,
          estudiante_id: participantId,
          estudiante: { id: participantId } as never,
          generacion_id: generation.id,
          generacion: generation,
          origen: DocumentoPatOrigen.FIRMADO,
          fecha_carga: new Date(),
        }));
        await this.notificaciones.registrarEventoPat(manager, { tipo: 'PAT_ENTREGADO', entidadTipo: 'documento_pat', entidadId: created.id, documentoId: created.id, asignacionId, actorId: actor.id });
        await this.audit.registrar(manager, {
          actor, accion: 'CARGAR_DOCUMENTO_PAT', entidad_tipo: 'documento_pat', entidad_id: created.id,
          valores_anteriores: null,
          valores_nuevos: { id: created.id, asignacion_tema_id: asignacionId, estudiante_id: participantId, generacion_id: generation.id, version, formato: created.formato, tamano_bytes: file.size, hash_sha256: hash },
          ip_origen: ip,
        });
        await manager.getRepository(ArchivoPendiente).delete({ ruta_almacenamiento: key });
        return created.id;
      });
      const saved = await this.repository.findOne({ where: { id }, relations });
      if (!saved) throw new ServiceUnavailableException('No se pudo recuperar el documento PAT guardado.');
      return this.toResponse(saved);
    } catch (error: unknown) {
      await this.cleanup.solicitar(undefined, key);
      this.handleError(error);
    }
  }

  /**
   * Entrega directa, sin firma, del PDF de una generación LISTO propia. La nueva versión referencia el
   * mismo objeto de almacenamiento que la generación (ruta, hash y tamaño; el trigger lo exige): las
   * generaciones son historial inmutable y la limpieza solo borra claves sin referencias, así que no
   * se copia el archivo. Mismas reglas de versión, notificación y auditoría que la carga firmada.
   */
  async entregarGenerada(periodoId: string, asignacionId: string, generacionId: string, actor: Usuario, ip: string | null): Promise<DocumentoPatResponseDto> {
    if (actor.rol !== UsuarioRol.ESTUDIANTE) throw new ForbiddenException('Solo el estudiante titular o integrante puede entregar su PAT individual.');
    const initial = await this.context(this.dataSource, periodoId, asignacionId);
    await this.authorizeUpload(this.dataSource, initial, actor);
    const studentId = await this.studentId(this.dataSource, actor.id);
    if (!studentId) throw new ForbiddenException('Se requiere un perfil de estudiante.');
    let id: string;
    try {
      id = await this.dataSource.transaction(async (manager) => {
        const period = await manager.query(
          `SELECT "estado"::text AS estado FROM ${this.schema()}."periodo_titulacion" WHERE "id"=$1 FOR UPDATE`, [periodoId],
        ) as Array<{ estado: string }>;
        if (!period[0]) throw new NotFoundException('No existe el período indicado.');
        if (!['POSTULACION_CERRADA', 'EN_CURSO'].includes(period[0].estado)) throw new ConflictException('La entrega PAT solo se permite con postulaciones cerradas o durante titulación.');
        const context = await this.context(manager, periodoId, asignacionId, true);
        if (context.asignacion_estado !== AsignacionTemaEstado.VIGENTE) throw new ConflictException('La asignación de tema ya no está vigente.');
        await this.authorizeUpload(manager, context, actor);
        const generation = await manager.getRepository(GeneracionPat).findOne({ where: { id: generacionId, asignacion_tema_id: asignacionId, estudiante_id: studentId }, lock: { mode: 'pessimistic_write' } });
        if (!generation) throw new NotFoundException('No existe esa generación PAT.');
        if (generation.estado !== 'LISTO' || !generation.ruta_almacenamiento || !generation.hash_sha256 || !generation.tamano_bytes) throw new ConflictException('La generación todavía no está disponible.');
        const delivered = await manager.query(`SELECT 1 FROM ${this.schema()}."documento_pat" WHERE "generacion_id"=$1 AND "origen"='GENERADO' LIMIT 1`, [generation.id]) as unknown[];
        if (delivered.length) throw new ConflictException('Esta generación ya fue entregada; genera una nueva versión del PAT para volver a entregar.');
        await this.assertCorrectionAllowed(manager, asignacionId, studentId);
        const latest = await manager.query(
          `SELECT COALESCE(MAX("version"),0)::int AS version FROM ${this.schema()}."documento_pat" WHERE "asignacion_tema_id"=$1 AND "estudiante_id"=$2`, [asignacionId, studentId],
        ) as Array<{ version: number }>;
        const version = Number(latest[0]?.version ?? 0) + 1;
        if (version > 32767) throw new ConflictException('El trabajo alcanzó el máximo de versiones PAT permitido.');
        const repo = manager.getRepository(DocumentoPat);
        const created = await repo.save(repo.create({
          asignacion_tema_id: asignacionId,
          asignacion_tema: { id: asignacionId } as never,
          plantilla_id: null,
          version,
          nombre_archivo: 'PAT-generado.pdf',
          ruta_almacenamiento: generation.ruta_almacenamiento,
          formato: DocumentoPatFormato.PDF,
          tamano_bytes: generation.tamano_bytes,
          hash_sha256: generation.hash_sha256,
          cargado_por_id: actor.id,
          cargado_por: actor,
          estudiante_id: studentId,
          estudiante: { id: studentId } as never,
          generacion_id: generation.id,
          generacion: generation,
          origen: DocumentoPatOrigen.GENERADO,
          fecha_carga: new Date(),
        }));
        await this.notificaciones.registrarEventoPat(manager, { tipo: 'PAT_ENTREGADO', entidadTipo: 'documento_pat', entidadId: created.id, documentoId: created.id, asignacionId, actorId: actor.id });
        await this.audit.registrar(manager, {
          actor, accion: 'ENTREGAR_PAT_GENERADO', entidad_tipo: 'documento_pat', entidad_id: created.id,
          valores_anteriores: null,
          valores_nuevos: { id: created.id, asignacion_tema_id: asignacionId, estudiante_id: studentId, generacion_id: generation.id, version, origen: DocumentoPatOrigen.GENERADO, firmado: false, tamano_bytes: Number(generation.tamano_bytes), hash_sha256: generation.hash_sha256 },
          ip_origen: ip,
        });
        return created.id;
      });
    } catch (error: unknown) { this.handleError(error); }
    const saved = await this.repository.findOne({ where: { id }, relations });
    if (!saved) throw new ServiceUnavailableException('No se pudo recuperar el documento PAT entregado.');
    return this.toResponse(saved);
  }

  async listar(periodoId: string, asignacionId: string, actor: Usuario, page: number, limit: number): Promise<PagedDocumentoPatResponseDto> {
    await this.authorizeRead(periodoId, asignacionId, actor);
    try {
      const studentId = actor.rol === UsuarioRol.ESTUDIANTE ? await this.studentId(this.dataSource, actor.id) : null;
      const where = studentId ? { asignacion_tema_id: asignacionId, estudiante_id: studentId } : { asignacion_tema_id: asignacionId };
      const [rows, total] = await this.repository.findAndCount({
        where, relations,
        order: { version: 'DESC', id: 'ASC' }, skip: (page - 1) * limit, take: limit,
      });
      return { data: rows.map((row) => this.toResponse(row)), total, page, limit };
    } catch (error: unknown) { this.handleError(error); }
  }

  async ultima(periodoId: string, asignacionId: string, actor: Usuario): Promise<DocumentoPatResponseDto> {
    await this.authorizeRead(periodoId, asignacionId, actor);
    let item: DocumentoPat | null;
    try { const sid = actor.rol === UsuarioRol.ESTUDIANTE ? await this.studentId(this.dataSource, actor.id) : null; item = await this.repository.findOne({ where: sid ? { asignacion_tema_id: asignacionId, estudiante_id: sid } : { asignacion_tema_id: asignacionId }, relations, order: { version: 'DESC' } }); }
    catch (error: unknown) { this.handleError(error); }
    if (!item) throw new NotFoundException('El trabajo todavía no tiene documentos PAT.');
    return this.toResponse(item);
  }

  /**
   * Bandeja de revisión (ADMIN): por cada asignación VIGENTE del período, su última versión PAT con
   * la revisión. Una consulta para la página y otra para los documentos, sin consultas por trabajo.
   */
  async ultimasDelPeriodo(periodoId: string, query: ListUltimasPatQueryDto): Promise<PagedUltimasPatResponseDto> {
    const s = this.schema();
    let rows: Array<{ asignacion_tema_id: string; tema_id: string; tema_titulo: string; grupo_id: string | null; grupo_nombre: string | null; documento_id: string | null; estado: EstadoUltimaPat; participante: UltimaPatParticipanteDto; participantes: UltimaPatParticipanteDto[] }>;
    try {
      const period = await this.dataSource.query(`SELECT 1 FROM ${s}."periodo_titulacion" WHERE "id"=$1`, [periodoId]) as unknown[];
      if (!period.length) throw new NotFoundException('No existe el período indicado.');
      rows = await this.dataSource.query(
        `SELECT * FROM (
           SELECT a."id" AS asignacion_tema_id, t."id" AS tema_id, t."titulo" AS tema_titulo, g."id" AS grupo_id, g."nombre" AS grupo_nombre,
             ult."id" AS documento_id, ult."fecha_carga",
             COALESCE(ult."resultado", CASE WHEN ult."id" IS NULL THEN 'SIN_ENTREGA' ELSE 'PENDIENTE' END) AS estado,
             jsonb_build_object('id',e."id",'nombres',u."nombres",'apellidos',u."apellidos",'matricula',e."matricula") AS participante,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('id',ep."id",'nombres',up."nombres",'apellidos',up."apellidos",'matricula',ep."matricula") ORDER BY up."apellidos",up."nombres",ep."id")
               FROM ${s}."estudiante" ep JOIN ${s}."usuario" up ON up."id"=ep."usuario_id"
               WHERE ep."id"=a."estudiante_id" OR EXISTS (SELECT 1 FROM ${s}."grupo_integrante" gi WHERE gi."grupo_id"=a."grupo_id" AND gi."estudiante_id"=ep."id" AND gi."estado"='ACTIVO')), '[]'::jsonb) AS participantes
           FROM ${s}."asignacion_tema" a
           JOIN ${s}."tema" t ON t."id"=a."tema_id"
           LEFT JOIN ${s}."grupo" g ON g."id"=a."grupo_id"
           JOIN ${s}."estudiante" e ON (e."id"=a."estudiante_id" OR EXISTS(SELECT 1 FROM ${s}."grupo_integrante" gi WHERE gi."grupo_id"=a."grupo_id" AND gi."estudiante_id"=e."id" AND gi."estado"='ACTIVO'))
           JOIN ${s}."usuario" u ON u."id"=e."usuario_id"
           LEFT JOIN LATERAL (
             SELECT d."id", d."fecha_carga", r."resultado"::text AS resultado FROM ${s}."documento_pat" d
             LEFT JOIN ${s}."revision_pat" r ON r."documento_pat_id"=d."id"
             WHERE d."asignacion_tema_id"=a."id" AND d."estudiante_id"=e."id"
             ORDER BY d."version" DESC LIMIT 1
           ) ult ON true
           WHERE a."periodo_id"=$1 AND a."estado"='VIGENTE'
         ) x
         WHERE ($2::text IS NULL OR x."estado"=$2)
         ORDER BY x."fecha_carga" ASC NULLS LAST, x."asignacion_tema_id" ASC`,
        [periodoId, query.estado ?? null],
      ) as typeof rows;
    } catch (error: unknown) { this.handleError(error); }
    const total = rows.length;
    const page = rows.slice((query.page - 1) * query.limit, query.page * query.limit);
    const ids = page.flatMap((row) => (row.documento_id ? [row.documento_id] : []));
    let documents: DocumentoPat[] = [];
    try { documents = ids.length ? await this.repository.find({ where: { id: In(ids) }, relations }) : []; }
    catch (error: unknown) { this.handleError(error); }
    const byId = new Map(documents.map((item) => [item.id, item]));
    return {
      data: page.map((row) => {
        const document = row.documento_id ? byId.get(row.documento_id) : undefined;
        return {
          asignacion_tema_id: row.asignacion_tema_id,
          tema: { id: row.tema_id, titulo: row.tema_titulo },
          grupo: row.grupo_id ? { id: row.grupo_id, nombre: row.grupo_nombre ?? '' } : null,
          estudiante: row.participante,
          participantes: row.participantes,
          estado: row.estado,
          documento: document ? this.toResponse(document) : null,
        };
      }),
      total, page: query.page, limit: query.limit,
    };
  }

  async porId(periodoId: string, asignacionId: string, id: string, actor: Usuario): Promise<DocumentoPatResponseDto> {
    await this.authorizeRead(periodoId, asignacionId, actor);
    let item: DocumentoPat | null;
    try { item = await this.repository.findOne({ where: { id, asignacion_tema_id: asignacionId }, relations }); if (item && actor.rol === UsuarioRol.ESTUDIANTE && (!item.estudiante_id || item.estudiante_id !== await this.studentId(this.dataSource, actor.id))) item = null; }
    catch (error: unknown) { this.handleError(error); }
    if (!item) throw new NotFoundException('No existe esa versión PAT para el trabajo indicado.');
    return this.toResponse(item);
  }

  async descargarUltima(periodoId: string, asignacionId: string, actor: Usuario): Promise<DocumentoPatDownloadDto> {
    await this.authorizeRead(periodoId, asignacionId, actor);
    let item: DocumentoPat | null;
    try { const sid = actor.rol === UsuarioRol.ESTUDIANTE ? await this.studentId(this.dataSource, actor.id) : null; item = await this.repository.findOne({ where: sid ? { asignacion_tema_id: asignacionId, estudiante_id: sid } : { asignacion_tema_id: asignacionId }, order: { version: 'DESC' } }); }
    catch (error: unknown) { this.handleError(error); }
    if (!item) throw new NotFoundException('El trabajo todavía no tiene documentos PAT.');
    return this.download(item);
  }

  async descargarPorId(periodoId: string, asignacionId: string, id: string, actor: Usuario): Promise<DocumentoPatDownloadDto> {
    await this.authorizeRead(periodoId, asignacionId, actor);
    let item: DocumentoPat | null;
    try { item = await this.repository.findOne({ where: { id, asignacion_tema_id: asignacionId } }); if (item && actor.rol === UsuarioRol.ESTUDIANTE && (!item.estudiante_id || item.estudiante_id !== await this.studentId(this.dataSource, actor.id))) item = null; }
    catch (error: unknown) { this.handleError(error); }
    if (!item) throw new NotFoundException('No existe esa versión PAT para el trabajo indicado.');
    return this.download(item);
  }

  private async authorizeRead(periodoId: string, assignmentId: string, actor: Usuario): Promise<void> {
    const context = await this.context(this.dataSource, periodoId, assignmentId);
    if (actor.rol === UsuarioRol.ADMIN) return;
    if (actor.rol === UsuarioRol.ESTUDIANTE) {
      const student = await this.studentId(this.dataSource, actor.id);
      if (!student) throw new NotFoundException('No existe un perfil de estudiante para la cuenta.');
      if (context.estudiante_id === student || (context.grupo_id && await this.isGroupMember(this.dataSource, context.grupo_id, student))) return;
      throw new NotFoundException('No existe el trabajo indicado.');
    }
    if (actor.rol === UsuarioRol.DOCENTE) {
      let rows: unknown[];
      try { rows = await this.dataSource.query(
          `SELECT 1 FROM ${this.schema()}."asignacion_tutor" WHERE "asignacion_tema_id"=$1 AND "estado"='VIGENTE' AND "docente_id"=(SELECT "id" FROM ${this.schema()}."docente" WHERE "usuario_id"=$2) LIMIT 1`,
          [assignmentId, actor.id],
        ) as unknown[]; }
      catch (error: unknown) { this.handleError(error); }
      if (rows.length) return;
    }
    throw new NotFoundException('No existe el trabajo indicado.');
  }

  /**
   * Autorización previa a recibir el cuerpo multipart (la usa `DocumentoPatCargaGuard`): misma
   * regla que `cargar`, que vuelve a comprobarla dentro de la transacción con los bloqueos.
   */
  async preautorizarCarga(periodoId: string, asignacionId: string, actor: Usuario): Promise<void> {
    const context = await this.context(this.dataSource, periodoId, asignacionId);
    await this.authorizeUpload(this.dataSource, context, actor);
  }

  async autorizarLectura(periodoId: string, assignmentId: string, actor: Usuario): Promise<void> {
    await this.authorizeRead(periodoId, assignmentId, actor);
  }

  async autorizarLecturaDocumento(periodoId: string, assignmentId: string, documentId: string, actor: Usuario): Promise<void> {
    await this.authorizeRead(periodoId, assignmentId, actor);
    let rows: Array<{ estudiante_id: string | null }>;
    try { rows = await this.dataSource.query(`SELECT d."estudiante_id" FROM ${this.schema()}."documento_pat" d JOIN ${this.schema()}."asignacion_tema" a ON a."id"=d."asignacion_tema_id" WHERE d."id"=$1 AND a."id"=$2 AND a."periodo_id"=$3`, [documentId, assignmentId, periodoId]) as Array<{ estudiante_id: string | null }>; }
    catch (error: unknown) { this.handleError(error); }
    if (!rows[0]) throw new NotFoundException('No existe el documento PAT indicado.');
    if (actor.rol === UsuarioRol.ESTUDIANTE) {
      const studentId = await this.studentId(this.dataSource, actor.id);
      if (!rows[0].estudiante_id || studentId !== rows[0].estudiante_id) throw new NotFoundException('No existe el documento PAT indicado.');
    }
  }

  private async assertCorrectionAllowed(source: DataSource | import('typeorm').EntityManager, assignmentId: string, studentId?: string): Promise<void> {
    let rows: Array<{ revision: RevisionPatResultado | null }>;
    try {
      rows = await source.query(
        `SELECT r."resultado"::text AS revision FROM ${this.schema()}."documento_pat" d LEFT JOIN ${this.schema()}."revision_pat" r ON r."documento_pat_id"=d."id" WHERE d."asignacion_tema_id"=$1 AND ($2::uuid IS NULL OR d."estudiante_id"=$2) ORDER BY d."version" DESC LIMIT 1`,
        [assignmentId, studentId ?? null],
      ) as Array<{ revision: RevisionPatResultado | null }>;
    } catch (error: unknown) { this.handleError(error); }
    if (rows[0] && ![RevisionPatResultado.OBSERVADO, RevisionPatResultado.RECHAZADO].includes(rows[0].revision as RevisionPatResultado)) {
      throw new ConflictException(rows[0].revision === null
        ? 'La última versión del PAT todavía está pendiente de revisión.'
        : 'La última versión del PAT ya fue aprobada y no admite otra entrega.');
    }
  }

  private async assertGeneration(source: DataSource | import('typeorm').EntityManager, assignmentId: string, generationId: string, studentId: string, lock = false): Promise<GeneracionPat> {
    const generation = await source.getRepository(GeneracionPat).findOne({ where: { id: generationId, asignacion_tema_id: assignmentId, estudiante_id: studentId }, ...(lock ? { lock: { mode: 'pessimistic_write' } as const } : {}) });
    if (!generation || generation.estado !== 'LISTO' || !generation.ruta_almacenamiento) throw new ConflictException('La generación PAT indicada no está disponible o no pertenece al estudiante y trabajo.');
    return generation;
  }

  private async exigirParticipante(source: DataSource | import('typeorm').EntityManager, periodoId: string, assignmentId: string, estudianteId: string): Promise<void> {
    const rows = await source.query(
      `SELECT 1 FROM ${this.schema()}."asignacion_tema" a WHERE a."id"=$1 AND a."periodo_id"=$2 AND a."estado"='VIGENTE' AND (a."estudiante_id"=$3 OR EXISTS (SELECT 1 FROM ${this.schema()}."grupo_integrante" gi WHERE gi."grupo_id"=a."grupo_id" AND gi."estudiante_id"=$3 AND gi."estado"='ACTIVO'))`,
      [assignmentId, periodoId, estudianteId],
    ) as unknown[];
    if (!rows.length) throw new NotFoundException('El estudiante no pertenece a una asignación vigente.');
  }

  private async authorizeUpload(source: DataSource | import('typeorm').EntityManager, context: AssignmentContext, actor: Usuario): Promise<void> {
    if (actor.rol !== UsuarioRol.ESTUDIANTE) throw new ForbiddenException('Solo ESTUDIANTE puede cargar documentos PAT.');
    const student = await this.studentId(source, actor.id);
    if (!student) throw new ForbiddenException('Se requiere un perfil de estudiante.');
    if (context.estudiante_id) {
      if (context.estudiante_id !== student) throw new ForbiddenException('Solo el titular puede entregar el PAT individual.');
      return;
    }
    if (context.grupo_id && await this.isGroupMember(source, context.grupo_id, student)) return;
    if (context.grupo_id) throw new ForbiddenException('Solo un integrante activo del grupo puede entregar su PAT individual.');
    throw new ConflictException('La asignación de tema no identifica un titular válido.');
  }

  private async context(source: DataSource | import('typeorm').EntityManager, periodoId: string, assignmentId: string, lock = false): Promise<AssignmentContext> {
    const suffix = lock ? ' FOR UPDATE OF a' : '';
    let rows: AssignmentContext[];
    try { rows = await source.query(
        `SELECT a."periodo_id", p."estado"::text AS periodo_estado, a."estado"::text AS asignacion_estado, a."estudiante_id", a."grupo_id", a."tema_id" FROM ${this.schema()}."asignacion_tema" a JOIN ${this.schema()}."periodo_titulacion" p ON p."id"=a."periodo_id" WHERE a."id"=$1 AND a."periodo_id"=$2${suffix}`,
        [assignmentId, periodoId],
      ) as AssignmentContext[]; }
    catch (error: unknown) { this.handleError(error); }
    if (!rows[0]) throw new NotFoundException('No existe la asignación de tema en el período indicado.');
    return rows[0];
  }

  private async activeTemplate(source: DataSource | import('typeorm').EntityManager, periodoId: string, templateId: string, lock = false): Promise<PlantillaPat | null> {
    if (lock) {
      let rows: Array<{ id: string }>;
      try { rows = await source.query(`SELECT "id" FROM ${this.schema()}."plantilla_pat" WHERE "id"=$1 AND "periodo_id"=$2 AND "activa"=true FOR UPDATE`, [templateId, periodoId]) as Array<{ id: string }>; }
      catch (error: unknown) { this.handleError(error); }
      if (!rows[0]) return null;
      try { return await source.getRepository(PlantillaPat).findOneBy({ id: templateId, periodo_id: periodoId, activa: true }); }
      catch (error: unknown) { this.handleError(error); }
    }
    const repository = source.getRepository(PlantillaPat);
    let item: PlantillaPat | null;
    try { item = await repository.findOneBy({ id: templateId, periodo_id: periodoId, activa: true }); }
    catch (error: unknown) { this.handleError(error); }
    if (!item) throw new ConflictException('La plantilla indicada no está vigente para este período.');
    return item;
  }

  private async studentId(source: DataSource | import('typeorm').EntityManager, userId: string): Promise<string | null> {
    let rows: Array<{ id: string }>;
    try { rows = await source.query(`SELECT "id" FROM ${this.schema()}."estudiante" WHERE "usuario_id"=$1`, [userId]) as Array<{ id: string }>; }
    catch (error: unknown) { this.handleError(error); }
    return rows[0]?.id ?? null;
  }

  private async isGroupMember(source: DataSource | import('typeorm').EntityManager, groupId: string, studentId: string): Promise<boolean> {
    let rows: unknown[];
    // Solo integrantes ACTIVOS: un ex-integrante pierde la lectura del PAT (el historial queda para ADMIN).
    try { rows = await source.query(`SELECT 1 FROM ${this.schema()}."grupo_integrante" WHERE "grupo_id"=$1 AND "estudiante_id"=$2 AND "estado"='ACTIVO' LIMIT 1`, [groupId, studentId]) as unknown[]; }
    catch (error: unknown) { this.handleError(error); }
    return rows.length > 0;
  }

  private async download(item: DocumentoPat): Promise<DocumentoPatDownloadDto> {
    const mime = item.formato === DocumentoPatFormato.PDF ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const url = await this.storage.signPrivateDownload(item.ruta_almacenamiento, item.nombre_archivo, mime);
    return { url, expira_en: new Date(Date.now() + 5 * 60_000) };
  }

  private toResponse(item: DocumentoPat): DocumentoPatResponseDto {
    return {
      id: item.id, asignacion_tema_id: item.asignacion_tema_id, plantilla_id: item.plantilla_id, estudiante_id: item.estudiante_id, generacion_id: item.generacion_id,
      origen: item.origen ?? DocumentoPatOrigen.FIRMADO, firmado: (item.origen ?? DocumentoPatOrigen.FIRMADO) === DocumentoPatOrigen.FIRMADO,
      version: item.version, nombre_archivo: item.nombre_archivo, formato: item.formato,
      tamano_bytes: Number(item.tamano_bytes), hash_sha256: item.hash_sha256, fecha_carga: item.fecha_carga,
      revision: item.revision?.resultado ?? 'PENDIENTE',
      detalle_revision: item.revision ? this.toRevisionResponse(item.revision) : null,
      plantilla: item.plantilla ? { id: item.plantilla.id, version: item.plantilla.version, nombre_archivo: item.plantilla.nombre_archivo } : null,
      cargador: { id: item.cargado_por?.id ?? item.cargado_por_id, nombres: item.cargado_por?.nombres ?? '', apellidos: item.cargado_por?.apellidos ?? '' },
    };
  }

  private toRevisionResponse(revision: RevisionPat): RevisionPatResponseDto {
    return {
      id: revision.id, documento_pat_id: revision.documento_pat_id, revisor_id: revision.revisor_id,
      resultado: revision.resultado, observaciones: revision.observaciones, fecha_revision: revision.fecha_revision,
      revisor: { id: revision.revisor?.id ?? revision.revisor_id, nombres: revision.revisor?.nombres ?? '', apellidos: revision.revisor?.apellidos ?? '' },
    };
  }

  private schema(): string {
    const name = (this.dataSource.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new ServiceUnavailableException('El esquema PostgreSQL configurado no es válido.');
    return `"${name}"`;
  }

  private handleError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (error instanceof QueryFailedError) {
      const driver = error.driverError as DriverError;
      if (driver.code === '23505') throw new ConflictException('La operación entra en conflicto con otra versión o asignación simultánea.');
      if (['23503', '23514'].includes(driver.code ?? '')) throw new ConflictException('La carga no cumple las reglas vigentes del PAT.');
      if (['40001', '40P01'].includes(driver.code ?? '')) throw new ConflictException('Otra operación simultánea modificó este trabajo; vuelve a intentarlo.');
    }
    throw new ServiceUnavailableException('No fue posible completar la operación de documentos PAT.', { cause: error });
  }
}
