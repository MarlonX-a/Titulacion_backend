import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import type { AbrirPostulacionDto } from './dto/abrir-postulacion.dto.js';
import { CreatePeriodoDto } from './dto/create-periodo.dto.js';
import { PeriodoResponseDto } from './dto/periodo-response.dto.js';
import { UpdatePeriodoDto } from './dto/update-periodo.dto.js';
import { PeriodoTitulacion } from './entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from './enums/periodo-estado.enum.js';

interface PostgresDriverError {
  code?: string;
}

export interface PagedPeriodos {
  data: PeriodoResponseDto[];
  total: number;
  page: number;
  limit: number;
}

function responseFrom(periodo: PeriodoTitulacion): PeriodoResponseDto {
  return {
    id: periodo.id,
    codigo: periodo.codigo,
    nombre: periodo.nombre,
    fecha_inicio_postulacion: periodo.fecha_inicio_postulacion,
    fecha_fin_postulacion: periodo.fecha_fin_postulacion,
    fecha_inicio_titulacion: periodo.fecha_inicio_titulacion,
    estado: periodo.estado,
    max_integrantes_default: periodo.max_integrantes_default,
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as PostgresDriverError;
  return driverError.code === '23505';
}

function assertCalendar(
  inicioPostulacion: Date,
  finPostulacion: Date,
  inicioTitulacion: Date,
): void {
  if (finPostulacion.getTime() <= inicioPostulacion.getTime()) {
    throw new BadRequestException(
      'La fecha fin de postulación debe ser posterior a su fecha de inicio.',
    );
  }
  if (inicioTitulacion.getTime() < finPostulacion.getTime()) {
    throw new BadRequestException(
      'La fecha de inicio de titulación debe ser igual o posterior al cierre de postulaciones.',
    );
  }
}

function datesFrom(dto: CreatePeriodoDto | UpdatePeriodoDto) {
  return {
    ...(dto.fecha_inicio_postulacion !== undefined
      ? { fecha_inicio_postulacion: new Date(dto.fecha_inicio_postulacion) }
      : {}),
    ...(dto.fecha_fin_postulacion !== undefined
      ? { fecha_fin_postulacion: new Date(dto.fecha_fin_postulacion) }
      : {}),
    ...(dto.fecha_inicio_titulacion !== undefined
      ? { fecha_inicio_titulacion: new Date(dto.fecha_inicio_titulacion) }
      : {}),
  };
}

@Injectable()
export class PeriodosService {
  constructor(
    @InjectRepository(PeriodoTitulacion)
    private readonly repository: Repository<PeriodoTitulacion>,
    private readonly dataSource: DataSource,
    private readonly auditoria: AuditoriaService,
  ) {}

  async create(dto: CreatePeriodoDto): Promise<PeriodoResponseDto> {
    const dates = datesFrom(dto);
    assertCalendar(
      dates.fecha_inicio_postulacion!,
      dates.fecha_fin_postulacion!,
      dates.fecha_inicio_titulacion!,
    );

    try {
      const periodo = await this.repository.save(
        this.repository.create({
          codigo: dto.codigo.trim(),
          nombre: dto.nombre.trim(),
          ...dates,
          estado: PeriodoEstado.BORRADOR,
          max_integrantes_default: dto.max_integrantes_default,
        }),
      );
      return responseFrom(periodo);
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  async list(query: PaginationQueryDto): Promise<PagedPeriodos> {
    try {
      const [periodos, total] = await this.repository.findAndCount({
        order: { fecha_inicio_postulacion: 'DESC', id: 'ASC' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      return {
        data: periodos.map(responseFrom),
        total,
        page: query.page,
        limit: query.limit,
      };
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  async getById(id: string): Promise<PeriodoResponseDto> {
    try {
      const periodo = await this.repository.findOneBy({ id });
      if (!periodo) {
        throw new NotFoundException('No existe el período solicitado.');
      }
      return responseFrom(periodo);
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  async update(
    id: string,
    dto: UpdatePeriodoDto,
  ): Promise<PeriodoResponseDto> {
    if (!Object.values(dto).some((value) => value !== undefined)) {
      throw new BadRequestException('Debe indicar al menos un campo para editar.');
    }

    try {
      const periodo = await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(PeriodoTitulacion);
        const current = await repository.findOne({
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!current) {
          throw new NotFoundException('No existe el período solicitado.');
        }
        if (current.estado !== PeriodoEstado.BORRADOR) {
          throw new ConflictException(
            'Solo se pueden editar períodos en estado BORRADOR.',
          );
        }

        const values = {
          ...(dto.codigo !== undefined ? { codigo: dto.codigo.trim() } : {}),
          ...(dto.nombre !== undefined ? { nombre: dto.nombre.trim() } : {}),
          ...datesFrom(dto),
          ...(dto.max_integrantes_default !== undefined
            ? { max_integrantes_default: dto.max_integrantes_default }
            : {}),
        };
        const next = { ...current, ...values };
        assertCalendar(
          next.fecha_inicio_postulacion,
          next.fecha_fin_postulacion,
          next.fecha_inicio_titulacion,
        );
        return repository.save(next);
      });
      return responseFrom(periodo);
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  async abrirPostulacion(
    id: string,
    _dto: AbrirPostulacionDto,
    actor: Usuario,
    ip: string | null,
  ): Promise<PeriodoResponseDto> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(PeriodoTitulacion);
        const periodo = await repository.findOne({
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!periodo) throw new NotFoundException('No existe el período solicitado.');
        if (periodo.estado !== PeriodoEstado.BORRADOR) {
          throw new ConflictException('Solo se pueden abrir períodos en estado BORRADOR.');
        }
        const now = new Date();
        if (now < periodo.fecha_inicio_postulacion || now >= periodo.fecha_fin_postulacion) {
          throw new ConflictException('El período solo puede abrirse dentro de las fechas de postulación.');
        }

        periodo.estado = PeriodoEstado.POSTULACION_ABIERTA;
        const updated = await repository.save(periodo);
        await this.auditoria.registrar(manager, {
          actor,
          accion: 'ABRIR_POSTULACION',
          entidad_tipo: 'periodo_titulacion',
          entidad_id: periodo.id,
          valores_anteriores: { estado: PeriodoEstado.BORRADOR },
          valores_nuevos: { estado: PeriodoEstado.POSTULACION_ABIERTA },
          ip_origen: ip,
        });
        return responseFrom(updated);
      });
    } catch (error: unknown) {
      this.handleDatabaseError(error);
    }
  }

  private handleDatabaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (isUniqueViolation(error)) {
      throw new ConflictException('Ya existe un período con ese código.');
    }
    throw new ServiceUnavailableException(
      'No se pudo completar la operación de períodos en PostgreSQL.',
    );
  }
}
