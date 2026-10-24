import {
  ConflictException,
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { CreateConfigCargaTutorialDto } from './dto/create-config-carga-tutorial.dto.js';
import { ConfigCargaEfectivaResponseDto } from './dto/config-carga-efectiva-response.dto.js';
import { ConfigCargaTutorialResponseDto } from './dto/config-carga-tutorial-response.dto.js';
import { UpdateConfigCargaTutorialDto } from './dto/update-config-carga-tutorial.dto.js';
import { ConfigCargaTutorial } from './entities/config-carga-tutorial.entity.js';
import { CargaTutorialPersistenciaService } from './carga-tutorial-persistencia.service.js';

interface PgError { code?: string }
export interface PagedConfig { data: ConfigCargaTutorialResponseDto[]; total: number; page: number; limit: number }

function response(config: ConfigCargaTutorial): ConfigCargaTutorialResponseDto {
  return {
    id: config.id,
    periodo_id: config.periodo_id,
    docente_id: config.docente_id,
    max_trabajos: config.max_trabajos,
    bloquear_al_superar: config.bloquear_al_superar,
  };
}

function pgCode(error: unknown): string | undefined {
  return error instanceof QueryFailedError ? (error.driverError as PgError).code : undefined;
}

@Injectable()
export class CargaTutorialService {
  constructor(
    @InjectRepository(ConfigCargaTutorial)
    private readonly configs: Repository<ConfigCargaTutorial>,
    @InjectRepository(PeriodoTitulacion)
    private readonly periodos: Repository<PeriodoTitulacion>,
    @InjectRepository(Docente)
    private readonly docentes: Repository<Docente>,
    private readonly dataSource: DataSource,
    private readonly auditoria: AuditoriaService,
    private readonly persistencia: CargaTutorialPersistenciaService,
  ) {}

  async create(periodoId: string, dto: CreateConfigCargaTutorialDto, actor: Usuario, ip: string | null) {
    try {
      const created = await this.dataSource.transaction(async (manager) => {
        const periodo = await this.lockPeriod(manager, periodoId);
        this.assertEditable(periodo);
        const docenteId = dto.docente_id ?? null;
        if (docenteId) await this.assertEligibleDocente(manager, docenteId);
        const repository = manager.getRepository(ConfigCargaTutorial);
        const config = await repository.save(repository.create({
          periodo_id: periodoId,
          docente_id: docenteId,
          max_trabajos: dto.max_trabajos,
          bloquear_al_superar: dto.bloquear_al_superar,
        }));
        await this.auditoria.registrar(manager, {
          actor,
          accion: 'CREAR_CONFIG_CARGA_TUTORIAL',
          entidad_tipo: 'config_carga_tutorial',
          entidad_id: config.id,
          valores_anteriores: null,
          valores_nuevos: this.auditValues(config),
          ip_origen: ip,
        });
        return config;
      });
      return response(created);
    } catch (error: unknown) {
      this.handleError(error);
    }
  }

  async list(periodoId: string, query: PaginationQueryDto): Promise<PagedConfig> {
    try {
      await this.assertPeriodExists(this.periodos, periodoId);
      const qb = this.configs.createQueryBuilder('config')
        .where('config.periodo_id = :periodoId', { periodoId })
        .orderBy('CASE WHEN config.docente_id IS NULL THEN 0 ELSE 1 END', 'ASC')
        .addOrderBy('config.docente_id', 'ASC')
        .addOrderBy('config.id', 'ASC')
        .skip((query.page - 1) * query.limit)
        .take(query.limit);
      const [rows, total] = await qb.getManyAndCount();
      return { data: rows.map(response), total, page: query.page, limit: query.limit };
    } catch (error: unknown) {
      this.handleError(error);
    }
  }

  async update(periodoId: string, id: string, dto: UpdateConfigCargaTutorialDto, actor: Usuario, ip: string | null) {
    if (Object.keys(dto).length === 0) throw new BadRequestException('Debe indicar al menos un campo para modificar.');
    try {
      const updated = await this.dataSource.transaction(async (manager) => {
        const periodo = await this.lockPeriod(manager, periodoId);
        this.assertEditable(periodo);
        const repository = manager.getRepository(ConfigCargaTutorial);
        const config = await repository.findOne({
          where: { id, periodo_id: periodoId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!config) throw new NotFoundException('No existe esa configuración en el período indicado.');
        const previous = this.auditValues(config);
        const changed = (dto.max_trabajos !== undefined && dto.max_trabajos !== config.max_trabajos)
          || (dto.bloquear_al_superar !== undefined && dto.bloquear_al_superar !== config.bloquear_al_superar);
        if (!changed) return config;
        if (dto.max_trabajos !== undefined) config.max_trabajos = dto.max_trabajos;
        if (dto.bloquear_al_superar !== undefined) config.bloquear_al_superar = dto.bloquear_al_superar;
        const saved = await repository.save(config);
        await this.auditoria.registrar(manager, {
          actor,
          accion: 'ACTUALIZAR_CONFIG_CARGA_TUTORIAL',
          entidad_tipo: 'config_carga_tutorial',
          entidad_id: saved.id,
          valores_anteriores: previous,
          valores_nuevos: this.auditValues(saved),
          ip_origen: ip,
        });
        return saved;
      });
      return response(updated);
    } catch (error: unknown) {
      this.handleError(error);
    }
  }

  async effectiveForUser(periodoId: string, actor: Usuario): Promise<ConfigCargaEfectivaResponseDto> {
    try {
      const docente = await this.docentes.findOne({ where: { usuario: { id: actor.id } } });
      if (!docente) throw new NotFoundException('La cuenta no tiene un perfil docente.');
      return await this.effective(periodoId, docente.id);
    } catch (error: unknown) {
      this.handleError(error);
    }
  }

  async effectiveForDocente(periodoId: string, docenteId: string): Promise<ConfigCargaEfectivaResponseDto> {
    try {
      const docente = await this.docentes.findOneBy({ id: docenteId });
      if (!docente) throw new NotFoundException('No existe el perfil docente solicitado.');
      return await this.effective(periodoId, docenteId);
    } catch (error: unknown) {
      this.handleError(error);
    }
  }

  private async effective(periodoId: string, docenteId: string): Promise<ConfigCargaEfectivaResponseDto> {
    try {
      await this.assertPeriodExists(this.periodos, periodoId);
      const result = await this.persistencia.resolverConfiguracionEfectiva(this.dataSource.manager, periodoId, docenteId);
      return {
        periodo_id: periodoId,
        docente_id: docenteId,
        origen: result.origen,
        configuracion: result.configuracion ? response(result.configuracion) : null,
      };
    } catch (error: unknown) {
      this.handleError(error);
    }
  }

  private async lockPeriod(manager: EntityManager, id: string): Promise<PeriodoTitulacion> {
    const periodo = await manager.getRepository(PeriodoTitulacion).findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!periodo) throw new NotFoundException('No existe el período solicitado.');
    return periodo;
  }

  private async assertEligibleDocente(manager: EntityManager, id: string): Promise<void> {
    const docente = await manager.getRepository(Docente).createQueryBuilder('docente')
      .innerJoinAndSelect('docente.usuario', 'usuario')
      .setLock('pessimistic_write')
      .where('docente.id = :id', { id })
      .getOne();
    if (!docente) throw new ConflictException('La configuración específica requiere un perfil docente existente.');
    if (docente.usuario.estado !== UsuarioEstado.ACTIVO || docente.usuario.rol !== UsuarioRol.DOCENTE) {
      throw new ConflictException('La configuración específica requiere una cuenta activa con rol DOCENTE.');
    }
  }

  private async assertPeriodExists(repository: Repository<PeriodoTitulacion>, id: string): Promise<PeriodoTitulacion> {
    const period = await repository.findOneBy({ id });
    if (!period) throw new NotFoundException('No existe el período solicitado.');
    return period;
  }

  private assertEditable(periodo: PeriodoTitulacion): void {
    if (periodo.estado === PeriodoEstado.ARCHIVADO) {
      throw new ConflictException('No se pueden cambiar configuraciones de un período ARCHIVADO.');
    }
  }

  private auditValues(config: ConfigCargaTutorial): Record<string, unknown> {
    return {
      periodo_id: config.periodo_id,
      docente_id: config.docente_id,
      max_trabajos: config.max_trabajos,
      bloquear_al_superar: config.bloquear_al_superar,
    };
  }

  private handleError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    const code = pgCode(error);
    if (code === '23505') throw new ConflictException('Ya existe una configuración para ese ámbito en el período.');
    if (code === '23503') throw new ConflictException('El período o docente indicado no existe o no puede modificarse.');
    throw new ServiceUnavailableException('No fue posible completar la operación de carga tutorial.');
  }
}
