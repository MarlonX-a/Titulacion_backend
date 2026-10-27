import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { PeriodoTitulacion } from './entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from './enums/periodo-estado.enum.js';
import type { ArchivarPeriodoDto } from './dto/archivar-periodo.dto.js';
import type { PeriodoResponseDto } from './dto/periodo-response.dto.js';

interface PostgresError { code?: string }

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

function postgresCode(error: unknown): string | undefined {
  return error instanceof QueryFailedError
    ? (error.driverError as PostgresError).code
    : undefined;
}

@Injectable()
export class ArchivoPeriodoService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditoria: AuditoriaService,
  ) {}

  async archivar(
    id: string,
    dto: ArchivarPeriodoDto,
    actor: Usuario,
    ip: string | null,
  ): Promise<PeriodoResponseDto> {
    try {
      const periodo = await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
        const repository = manager.getRepository(PeriodoTitulacion);
        const current = await repository.findOne({
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!current) throw new NotFoundException('No existe el período solicitado.');
        if (current.estado !== PeriodoEstado.EN_CURSO) {
          throw new ConflictException('Solo se pueden archivar períodos en estado EN_CURSO.');
        }

        const responsible = await manager.getRepository(Usuario).findOne({
          where: { id: actor.id },
          lock: { mode: 'pessimistic_read' },
        });
        if (!responsible || responsible.rol !== UsuarioRol.ADMIN || responsible.estado !== UsuarioEstado.ACTIVO) {
          throw new ConflictException('Se requiere una cuenta ADMIN activa para archivar el período.');
        }

        const previous = { estado: current.estado };
        current.estado = PeriodoEstado.ARCHIVADO;
        const updated = await repository.save(current);
        await this.auditoria.registrar(manager, {
          actor: responsible,
          accion: 'ARCHIVAR_PERIODO',
          entidad_tipo: 'periodo_titulacion',
          entidad_id: current.id,
          valores_anteriores: previous,
          valores_nuevos: { estado: PeriodoEstado.ARCHIVADO, motivo: dto.motivo.trim() },
          ip_origen: ip,
        });
        return updated;
      });
      return responseFrom(periodo);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      if (postgresCode(error) === '40001' || postgresCode(error) === '40P01') {
        throw new ConflictException('El archivo coincidió con otra actualización. Vuelve a intentarlo.');
      }
      if (postgresCode(error) === '23514') {
        throw new ConflictException('El período no puede archivarse en su estado actual.');
      }
      throw new ServiceUnavailableException('No se pudo archivar el período en PostgreSQL.');
    }
  }
}
