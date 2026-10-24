import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service.js';
import { ArchivoLimpiezaService } from '../almacenamiento/archivo-limpieza.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { ArchivoPendiente } from '../almacenamiento/entities/archivo-pendiente.entity.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { EstudianteHabilitado } from '../habilitados/entities/estudiante-habilitado.entity.js';
import { HabilitadoEstado } from '../habilitados/enums/habilitado-estado.enum.js';
import { SituacionIngreso } from '../habilitados/enums/situacion-ingreso.enum.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { PlantillaPat } from './entities/plantilla-pat.entity.js';
import { PublicarPlantillaPatDto } from './dto/publicar-plantilla-pat.dto.js';
import { PagedPlantillaPatResponseDto, PlantillaPatDownloadDto, PlantillaPatResponseDto } from './dto/plantilla-pat-response.dto.js';
import { validatePlantillaFile } from './plantilla-pat-file.validator.js';

interface PlantillaDriverError { code?: string }
const relations = { publicada_por: true } as const;

@Injectable()
export class PlantillasPatService {
  constructor(
    @InjectRepository(PlantillaPat) private readonly repository: Repository<PlantillaPat>,
    @InjectRepository(PeriodoTitulacion) private readonly periodos: Repository<PeriodoTitulacion>,
    @InjectRepository(Estudiante) private readonly estudiantes: Repository<Estudiante>,
    @InjectRepository(EstudianteHabilitado) private readonly habilitados: Repository<EstudianteHabilitado>,
    private readonly dataSource: DataSource,
    private readonly storage: AlmacenamientoService,
    private readonly auditoria: AuditoriaService,
    private readonly archivoLimpieza: ArchivoLimpiezaService,
  ) {}

  async publicar(periodoId: string, dto: PublicarPlantillaPatDto, file: Express.Multer.File | undefined, actor: Usuario, ip: string | null): Promise<PlantillaPatResponseDto> {
    if (!file) throw new BadRequestException('Adjunta el archivo en el campo archivo.');
    const validated = validatePlantillaFile(file);
    const periodBefore = await this.periodos.findOneBy({ id: periodoId });
    if (!periodBefore) throw new NotFoundException('No existe el período indicado.');
    if (periodBefore.estado === PeriodoEstado.ARCHIVADO) throw new ConflictException('No se pueden publicar plantillas en un período archivado.');
    if (await this.repository.exist({ where: { periodo_id: periodoId, version: dto.version } })) throw new ConflictException('Ya existe esa versión de plantilla en el período.');

    const key = this.storage.createPrivateKey('plantillas-pat', validated.extension);
    await this.archivoLimpieza.registrar(periodoId, key);
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    try {
      await this.storage.saveAtPrivateKey(key, file.buffer, validated.mimeType);
      const id = await this.dataSource.transaction(async (manager) => {
        const period = await manager.getRepository(PeriodoTitulacion).findOne({ where: { id: periodoId }, lock: { mode: 'pessimistic_write' } });
        if (!period) throw new NotFoundException('No existe el período indicado.');
        if (period.estado === PeriodoEstado.ARCHIVADO) throw new ConflictException('No se pueden publicar plantillas en un período archivado.');
        const repository = manager.getRepository(PlantillaPat);
        const old = await repository.findOne({ where: { periodo_id: periodoId, activa: true }, lock: { mode: 'pessimistic_write' } });
        const today = institutionalDate();
        const before = old ? this.snapshot(old) : null;
        if (old) {
          old.activa = false;
          old.fecha_vigencia_fin = today;
          await repository.save(old);
        }
        const created = await repository.save(repository.create({
          periodo_id: period.id,
          periodo: period,
          version: dto.version,
          nombre_archivo: validated.fileName,
          ruta_almacenamiento: key,
          mime_type: validated.mimeType,
          tamano_bytes: String(file.size),
          hash_sha256: hash,
          fecha_vigencia_inicio: today,
          fecha_vigencia_fin: null,
          publicada_por_id: actor.id,
          publicada_por: actor,
          activa: true,
        }));
        await this.auditoria.registrar(manager, {
          actor,
          accion: 'PUBLICAR_PLANTILLA_PAT',
          entidad_tipo: 'plantilla_pat',
          entidad_id: created.id,
          valores_anteriores: before,
          valores_nuevos: { ...this.snapshot(created), version_anterior_id: old?.id ?? null },
          ip_origen: ip,
        });
        await manager.getRepository(ArchivoPendiente).delete({ ruta_almacenamiento: key });
        return created.id;
      });
      const saved = await this.repository.findOne({ where: { id }, relations });
      if (!saved) throw new ServiceUnavailableException('No se pudo recuperar la versión publicada.');
      return this.toResponse(saved);
    } catch (error: unknown) {
      await this.archivoLimpieza.solicitar(undefined, key);
      this.handleError(error);
    }
  }

  async listar(periodoId: string, page: number, limit: number): Promise<PagedPlantillaPatResponseDto> {
    try {
      if (!await this.periodos.exist({ where: { id: periodoId } })) throw new NotFoundException('No existe el período indicado.');
      const [rows, total] = await this.repository.findAndCount({
        where: { periodo_id: periodoId },
        relations,
        order: { fecha_vigencia_inicio: 'DESC', id: 'ASC' },
        skip: (page - 1) * limit,
        take: limit,
      });
      return { data: rows.map((row) => this.toResponse(row)), total, page, limit };
    } catch (error: unknown) { this.handleError(error); }
  }

  async vigente(periodoId: string, actor: Usuario): Promise<PlantillaPatResponseDto> {
    try {
      await this.authorizeDownload(periodoId, actor);
      const item = await this.repository.findOne({ where: { periodo_id: periodoId, activa: true }, relations });
      if (!item) throw new NotFoundException('El período no tiene una plantilla PAT vigente.');
      return this.toResponse(item);
    } catch (error: unknown) { this.handleError(error); }
  }

  async descargarVigente(periodoId: string, actor: Usuario): Promise<PlantillaPatDownloadDto> {
    try {
      await this.authorizeDownload(periodoId, actor);
      const item = await this.repository.findOne({ where: { periodo_id: periodoId, activa: true } });
      if (!item) throw new NotFoundException('El período no tiene una plantilla PAT vigente.');
      return this.download(item);
    } catch (error: unknown) { this.handleError(error); }
  }

  async porId(periodoId: string, id: string): Promise<PlantillaPatResponseDto> {
    try {
      const item = await this.repository.findOne({ where: { id, periodo_id: periodoId }, relations });
      if (!item) throw new NotFoundException('No existe esa versión de plantilla en el período indicado.');
      return this.toResponse(item);
    } catch (error: unknown) { this.handleError(error); }
  }

  async descargarPorId(periodoId: string, id: string): Promise<PlantillaPatDownloadDto> {
    try {
      const item = await this.repository.findOne({ where: { id, periodo_id: periodoId } });
      if (!item) throw new NotFoundException('No existe esa versión de plantilla en el período indicado.');
      return await this.download(item);
    } catch (error: unknown) { this.handleError(error); }
  }

  private async authorizeDownload(periodoId: string, actor: Usuario): Promise<void> {
    if (actor.rol !== 'ESTUDIANTE') return;
    const student = await this.estudiantes.findOne({ where: { usuario: { id: actor.id } } });
    if (!student) throw new ForbiddenException('Se requiere un perfil de estudiante.');
    const enabled = await this.habilitados.findOne({ where: { periodo: { id: periodoId }, estudiante: { id: student.id } } });
    if (!enabled || enabled.estado !== HabilitadoEstado.HABILITADO || ![SituacionIngreso.PENDIENTE, SituacionIngreso.ADMITIDO].includes(enabled.situacion_ingreso)) {
      throw new ForbiddenException('El estudiante no está habilitado para este período.');
    }
  }

  private async download(item: PlantillaPat): Promise<PlantillaPatDownloadDto> {
    const url = await this.storage.signPrivateDownload(item.ruta_almacenamiento, item.nombre_archivo, item.mime_type);
    return { url, expira_en: new Date(Date.now() + 5 * 60_000) };
  }

  private snapshot(item: PlantillaPat): Record<string, unknown> {
    return {
      id: item.id,
      periodo_id: item.periodo_id,
      version: item.version,
      nombre_archivo: item.nombre_archivo,
      mime_type: item.mime_type,
      tamano_bytes: item.tamano_bytes,
      hash_sha256: item.hash_sha256,
      fecha_vigencia_inicio: item.fecha_vigencia_inicio,
      fecha_vigencia_fin: item.fecha_vigencia_fin,
      publicada_por_id: item.publicada_por_id,
      activa: item.activa,
    };
  }

  private toResponse(item: PlantillaPat): PlantillaPatResponseDto {
    const size = Number(item.tamano_bytes);
    return {
      id: item.id,
      periodo_id: item.periodo_id,
      version: item.version,
      nombre_archivo: item.nombre_archivo,
      mime_type: item.mime_type,
      tamano_bytes: size,
      hash_sha256: item.hash_sha256,
      fecha_vigencia_inicio: item.fecha_vigencia_inicio,
      fecha_vigencia_fin: item.fecha_vigencia_fin,
      publicada_por_id: item.publicada_por_id,
      activa: item.activa,
      publicador: {
        id: item.publicada_por?.id ?? item.publicada_por_id,
        nombres: item.publicada_por?.nombres ?? '',
        apellidos: item.publicada_por?.apellidos ?? '',
      },
    };
  }

  private handleError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (error instanceof QueryFailedError) {
      const driver = error.driverError as PlantillaDriverError;
      if (driver.code === '23505') throw new ConflictException('Ya existe esa versión de plantilla en el período.');
      if (['23503', '23514'].includes(driver.code ?? '')) throw new ConflictException('La publicación no cumple las reglas del período o de la plantilla.');
      if (['40001', '40P01'].includes(driver.code ?? '')) throw new ConflictException('Otra publicación simultánea modificó este período. Vuelve a intentarlo.');
    }
    throw new ServiceUnavailableException('No fue posible completar la operación de plantillas PAT.');
  }
}

function institutionalDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
