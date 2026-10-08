import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
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
import { DocumentoPatFormato } from './enums/documento-pat-formato.enum.js';
import { RevisionPat } from '../revisiones-pat/entities/revision-pat.entity.js';
import { RevisionPatResultado } from '../revisiones-pat/enums/revision-pat-resultado.enum.js';
import { RevisionPatResponseDto } from '../revisiones-pat/dto/revision-pat-response.dto.js';

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
  ) {}

  async cargar(periodoId: string, asignacionId: string, dto: CargarDocumentoPatDto, file: Express.Multer.File | undefined, actor: Usuario, ip: string | null): Promise<DocumentoPatResponseDto> {
    if (!file) throw new BadRequestException('Adjunta el archivo en el campo archivo.');
    if (actor.rol !== UsuarioRol.ESTUDIANTE) throw new ForbiddenException('Solo el titular o representante puede entregar el PAT.');
    const validated = validatePlantillaFile(file);
    const initial = await this.context(this.dataSource, periodoId, asignacionId);
    await this.authorizeUpload(this.dataSource, initial, actor);
    await this.activeTemplate(this.dataSource, periodoId, dto.plantilla_id);
    await this.assertCorrectionAllowed(this.dataSource, asignacionId);

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
        await this.authorizeUpload(manager, context, actor);
        const template = await this.activeTemplate(manager, periodoId, dto.plantilla_id, true);
        if (!template) throw new ConflictException('La plantilla indicada ya no es la vigente del período.');
        await this.assertCorrectionAllowed(manager, asignacionId);
        const latest = await manager.query(
          `SELECT COALESCE(MAX("version"),0)::int AS version FROM ${this.schema()}."documento_pat" WHERE "asignacion_tema_id"=$1`, [asignacionId],
        ) as Array<{ version: number }>;
        const version = Number(latest[0]?.version ?? 0) + 1;
        if (version > 32767) throw new ConflictException('El trabajo alcanzó el máximo de versiones PAT permitido.');
        const repo = manager.getRepository(DocumentoPat);
        const created = await repo.save(repo.create({
          asignacion_tema_id: asignacionId,
          asignacion_tema: { id: asignacionId } as never,
          plantilla_id: template.id,
          plantilla: template,
          version,
          nombre_archivo: validated.fileName,
          ruta_almacenamiento: key,
          formato: validated.extension === 'pdf' ? DocumentoPatFormato.PDF : DocumentoPatFormato.DOCX,
          tamano_bytes: String(file.size),
          hash_sha256: hash,
          cargado_por_id: actor.id,
          cargado_por: actor,
          fecha_carga: new Date(),
        }));
        await this.audit.registrar(manager, {
          actor, accion: 'CARGAR_DOCUMENTO_PAT', entidad_tipo: 'documento_pat', entidad_id: created.id,
          valores_anteriores: null,
          valores_nuevos: { id: created.id, asignacion_tema_id: asignacionId, plantilla_id: template.id, version, formato: created.formato, tamano_bytes: file.size, hash_sha256: hash },
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

  async listar(periodoId: string, asignacionId: string, actor: Usuario, page: number, limit: number): Promise<PagedDocumentoPatResponseDto> {
    await this.authorizeRead(periodoId, asignacionId, actor);
    try {
      const [rows, total] = await this.repository.findAndCount({
        where: { asignacion_tema_id: asignacionId }, relations,
        order: { version: 'DESC', id: 'ASC' }, skip: (page - 1) * limit, take: limit,
      });
      return { data: rows.map((row) => this.toResponse(row)), total, page, limit };
    } catch (error: unknown) { this.handleError(error); }
  }

  async ultima(periodoId: string, asignacionId: string, actor: Usuario): Promise<DocumentoPatResponseDto> {
    await this.authorizeRead(periodoId, asignacionId, actor);
    let item: DocumentoPat | null;
    try { item = await this.repository.findOne({ where: { asignacion_tema_id: asignacionId }, relations, order: { version: 'DESC' } }); }
    catch (error: unknown) { this.handleError(error); }
    if (!item) throw new NotFoundException('El trabajo todavía no tiene documentos PAT.');
    return this.toResponse(item);
  }

  async porId(periodoId: string, asignacionId: string, id: string, actor: Usuario): Promise<DocumentoPatResponseDto> {
    await this.authorizeRead(periodoId, asignacionId, actor);
    let item: DocumentoPat | null;
    try { item = await this.repository.findOne({ where: { id, asignacion_tema_id: asignacionId }, relations }); }
    catch (error: unknown) { this.handleError(error); }
    if (!item) throw new NotFoundException('No existe esa versión PAT para el trabajo indicado.');
    return this.toResponse(item);
  }

  async descargarUltima(periodoId: string, asignacionId: string, actor: Usuario): Promise<DocumentoPatDownloadDto> {
    await this.authorizeRead(periodoId, asignacionId, actor);
    let item: DocumentoPat | null;
    try { item = await this.repository.findOne({ where: { asignacion_tema_id: asignacionId }, order: { version: 'DESC' } }); }
    catch (error: unknown) { this.handleError(error); }
    if (!item) throw new NotFoundException('El trabajo todavía no tiene documentos PAT.');
    return this.download(item);
  }

  async descargarPorId(periodoId: string, asignacionId: string, id: string, actor: Usuario): Promise<DocumentoPatDownloadDto> {
    await this.authorizeRead(periodoId, asignacionId, actor);
    let item: DocumentoPat | null;
    try { item = await this.repository.findOne({ where: { id, asignacion_tema_id: asignacionId } }); }
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

  async autorizarLectura(periodoId: string, assignmentId: string, actor: Usuario): Promise<void> {
    await this.authorizeRead(periodoId, assignmentId, actor);
  }

  private async assertCorrectionAllowed(source: DataSource | import('typeorm').EntityManager, assignmentId: string): Promise<void> {
    let rows: Array<{ revision: RevisionPatResultado | null }>;
    try {
      rows = await source.query(
        `SELECT r."resultado"::text AS revision FROM ${this.schema()}."documento_pat" d LEFT JOIN ${this.schema()}."revision_pat" r ON r."documento_pat_id"=d."id" WHERE d."asignacion_tema_id"=$1 ORDER BY d."version" DESC LIMIT 1`,
        [assignmentId],
      ) as Array<{ revision: RevisionPatResultado | null }>;
    } catch (error: unknown) { this.handleError(error); }
    if (rows[0] && ![RevisionPatResultado.OBSERVADO, RevisionPatResultado.RECHAZADO].includes(rows[0].revision as RevisionPatResultado)) {
      throw new ConflictException(rows[0].revision === null
        ? 'La última versión del PAT todavía está pendiente de revisión.'
        : 'La última versión del PAT ya fue aprobada y no admite otra entrega.');
    }
  }

  private async authorizeUpload(source: DataSource | import('typeorm').EntityManager, context: AssignmentContext, actor: Usuario): Promise<void> {
    if (actor.rol !== UsuarioRol.ESTUDIANTE) throw new ForbiddenException('Solo ESTUDIANTE puede cargar documentos PAT.');
    const student = await this.studentId(source, actor.id);
    if (!student) throw new ForbiddenException('Se requiere un perfil de estudiante.');
    if (context.estudiante_id) {
      if (context.estudiante_id !== student) throw new ForbiddenException('Solo el titular puede entregar el PAT individual.');
      return;
    }
    if (context.grupo_id) {
      let rows: unknown[];
      try { rows = await source.query(
          `SELECT 1 FROM ${this.schema()}."grupo_integrante" gi JOIN ${this.schema()}."estudiante" e ON e."id"=gi."estudiante_id" WHERE gi."grupo_id"=$1 AND gi."estudiante_id"=$2 AND gi."estado"='ACTIVO' AND gi."rol_en_grupo"='REPRESENTANTE' AND e."usuario_id"=$3 LIMIT 1`,
          [context.grupo_id, student, actor.id],
        ) as unknown[]; }
      catch (error: unknown) { this.handleError(error); }
      if (rows.length) return;
      throw new ForbiddenException('Solo el representante actual del grupo puede entregar el PAT.');
    }
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
    try { rows = await source.query(`SELECT 1 FROM ${this.schema()}."grupo_integrante" WHERE "grupo_id"=$1 AND "estudiante_id"=$2 LIMIT 1`, [groupId, studentId]) as unknown[]; }
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
      id: item.id, asignacion_tema_id: item.asignacion_tema_id, plantilla_id: item.plantilla_id,
      version: item.version, nombre_archivo: item.nombre_archivo, formato: item.formato,
      tamano_bytes: Number(item.tamano_bytes), hash_sha256: item.hash_sha256, fecha_carga: item.fecha_carga,
      revision: item.revision?.resultado ?? 'PENDIENTE',
      detalle_revision: item.revision ? this.toRevisionResponse(item.revision) : null,
      plantilla: { id: item.plantilla?.id ?? item.plantilla_id, version: item.plantilla?.version ?? '', nombre_archivo: item.plantilla?.nombre_archivo ?? '' },
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
