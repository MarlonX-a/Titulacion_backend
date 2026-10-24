import { ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { AsignacionTemaEstado } from '../asignaciones-tema/enums/asignacion-tema-estado.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { DocumentosPatService } from '../documentos-pat/documentos-pat.service.js';
import { DocumentoPat } from '../documentos-pat/entities/documento-pat.entity.js';
import { CrearRevisionPatDto } from './dto/crear-revision-pat.dto.js';
import { RevisionPatResponseDto } from './dto/revision-pat-response.dto.js';
import { RevisionPat } from './entities/revision-pat.entity.js';
import { RevisionPatResultado } from './enums/revision-pat-resultado.enum.js';
import { NotificacionesPersistenciaService } from '../notificaciones/notificaciones-persistencia.service.js';

interface RevisionRow extends RevisionPat { revisor_nombres: string; revisor_apellidos: string }
interface DriverError { code?: string }

@Injectable()
export class RevisionesPatService {
  constructor(
    @InjectRepository(RevisionPat) private readonly repository: Repository<RevisionPat>,
    private readonly dataSource: DataSource,
    private readonly documentos: DocumentosPatService,
    private readonly audit: AuditoriaService,
    private readonly notificaciones: NotificacionesPersistenciaService,
  ) {}

  async crear(periodoId: string, asignacionId: string, documentoId: string, dto: CrearRevisionPatDto, actor: Usuario, ip: string | null): Promise<RevisionPatResponseDto> {
    if (actor.rol !== UsuarioRol.ADMIN) throw new ForbiddenException('Solo ADMIN puede revisar documentos PAT.');
    const observaciones = dto.observaciones?.trim() || null;
    if (dto.resultado !== RevisionPatResultado.APROBADO && !observaciones) throw new ConflictException('Las observaciones son obligatorias al observar o rechazar un PAT.');
    try {
      const id = await this.dataSource.transaction(async (manager) => {
        const period = await manager.query(
          `SELECT "estado"::text AS estado FROM ${this.schema()}."periodo_titulacion" WHERE "id"=$1 FOR UPDATE`, [periodoId],
        ) as Array<{ estado: string }>;
        if (!period[0]) throw new NotFoundException('No existe el período indicado.');
        if (!['POSTULACION_CERRADA', 'EN_CURSO'].includes(period[0].estado)) throw new ConflictException('Solo se pueden revisar PAT con postulaciones cerradas o durante titulación.');
        const assignments = await manager.query(
          `SELECT "id", "estado"::text AS estado FROM ${this.schema()}."asignacion_tema" WHERE "id"=$1 AND "periodo_id"=$2 FOR UPDATE`, [asignacionId, periodoId],
        ) as Array<{ id: string; estado: string }>;
        if (!assignments[0]) throw new NotFoundException('No existe la asignación indicada en el período.');
        if (assignments[0].estado !== AsignacionTemaEstado.VIGENTE) throw new ConflictException('No se puede revisar un PAT cuya asignación ya no está vigente.');
        const docs = await manager.query(
          `SELECT "id", "version" FROM ${this.schema()}."documento_pat" WHERE "id"=$1 AND "asignacion_tema_id"=$2 FOR UPDATE`, [documentoId, asignacionId],
        ) as Array<{ id: string; version: number }>;
        if (!docs[0]) throw new NotFoundException('No existe esa versión PAT para la asignación indicada.');
        const reviewers = await manager.query(
          `SELECT 1 FROM ${this.schema()}."usuario" WHERE "id"=$1 AND "rol"='ADMIN' AND "estado"='ACTIVO' FOR KEY SHARE`, [actor.id],
        ) as unknown[];
        if (!reviewers.length) throw new ForbiddenException('Se requiere una cuenta ADMIN activa.');
        const repo = manager.getRepository(RevisionPat);
        if (await repo.exist({ where: { documento_pat_id: documentoId } })) throw new ConflictException('Esta versión PAT ya tiene una revisión registrada.');
        const item = await repo.save(repo.create({ documento_pat_id: documentoId, documento_pat: { id: documentoId } as DocumentoPat, revisor_id: actor.id, revisor: actor, resultado: dto.resultado, observaciones, fecha_revision: new Date() }));
        await this.notificaciones.registrarEventoPat(manager, { tipo: 'PAT_REVISADO', entidadTipo: 'revision_pat', entidadId: item.id, documentoId, asignacionId, actorId: actor.id, resultado: item.resultado });
        await this.audit.registrar(manager, {
          actor, accion: 'REVISAR_DOCUMENTO_PAT', entidad_tipo: 'revision_pat', entidad_id: item.id,
          valores_anteriores: null,
          valores_nuevos: { id: item.id, documento_pat_id: documentoId, asignacion_tema_id: asignacionId, periodo_id: periodoId, version: docs[0]!.version, resultado: item.resultado, observaciones: item.observaciones, fecha_revision: item.fecha_revision },
          ip_origen: ip,
        });
        return item.id;
      });
      const item = await this.repository.findOne({ where: { id }, relations: { revisor: true } });
      if (!item) throw new ServiceUnavailableException('No se pudo recuperar la revisión registrada.');
      return this.toResponse(item);
    } catch (error: unknown) { this.handleError(error); }
  }

  async obtener(periodoId: string, asignacionId: string, documentoId: string, actor: Usuario): Promise<RevisionPatResponseDto> {
    await this.documentos.autorizarLectura(periodoId, asignacionId, actor);
    let rows: RevisionRow[];
    try {
      rows = await this.dataSource.query(
        `SELECT r.*, u."nombres" AS revisor_nombres, u."apellidos" AS revisor_apellidos FROM ${this.schema()}."revision_pat" r JOIN ${this.schema()}."documento_pat" d ON d."id"=r."documento_pat_id" JOIN ${this.schema()}."asignacion_tema" a ON a."id"=d."asignacion_tema_id" JOIN ${this.schema()}."usuario" u ON u."id"=r."revisor_id" WHERE r."documento_pat_id"=$1 AND a."id"=$2 AND a."periodo_id"=$3`,
        [documentoId, asignacionId, periodoId],
      ) as RevisionRow[];
    } catch (error: unknown) { this.handleError(error); }
    if (!rows[0]) {
      // Avoid distinguishing a foreign document from an unreviewed one.
      let exists: unknown[];
      try { exists = await this.dataSource.query(`SELECT 1 FROM ${this.schema()}."documento_pat" d JOIN ${this.schema()}."asignacion_tema" a ON a."id"=d."asignacion_tema_id" WHERE d."id"=$1 AND a."id"=$2 AND a."periodo_id"=$3`, [documentoId, asignacionId, periodoId]) as unknown[]; }
      catch (error: unknown) { this.handleError(error); }
      if (!exists.length) throw new NotFoundException('No existe esa versión PAT para la asignación indicada.');
      throw new NotFoundException('Esta versión PAT todavía no tiene una revisión.');
    }
    return this.toResponse(rows[0]);
  }

  private toResponse(item: RevisionPat | RevisionRow): RevisionPatResponseDto {
    return {
      id: item.id, documento_pat_id: item.documento_pat_id, revisor_id: item.revisor_id,
      resultado: item.resultado, observaciones: item.observaciones, fecha_revision: item.fecha_revision,
      revisor: { id: item.revisor?.id ?? item.revisor_id, nombres: item.revisor?.nombres ?? ('revisor_nombres' in item ? item.revisor_nombres : ''), apellidos: item.revisor?.apellidos ?? ('revisor_apellidos' in item ? item.revisor_apellidos : '') },
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
      if (driver.code === '23505') throw new ConflictException('Esta versión PAT ya tiene una revisión registrada.');
      if (['23503', '23514'].includes(driver.code ?? '')) throw new ConflictException('La revisión no cumple las reglas vigentes del PAT.');
      if (['40001', '40P01'].includes(driver.code ?? '')) throw new ConflictException('Otra operación simultánea modificó este PAT; vuelve a intentarlo.');
    }
    throw new ServiceUnavailableException('No fue posible completar la revisión del PAT.');
  }
}
