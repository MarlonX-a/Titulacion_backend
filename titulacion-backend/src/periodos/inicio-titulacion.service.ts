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
import { PeriodoTitulacion } from './entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from './enums/periodo-estado.enum.js';
import { PeriodoResponseDto } from './dto/periodo-response.dto.js';

interface PostgresError { code?: string; }

function isCode(error: unknown, code: string): boolean {
  return error instanceof QueryFailedError &&
    (error.driverError as PostgresError).code === code;
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

@Injectable()
export class InicioTitulacionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditoria: AuditoriaService,
  ) {}

  async iniciar(
    id: string,
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
        if (current.estado !== PeriodoEstado.POSTULACION_CERRADA) {
          throw new ConflictException('Solo se puede iniciar un período en POSTULACION_CERRADA.');
        }

        const now = new Date();
        if (now < current.fecha_inicio_titulacion) {
          throw new ConflictException('El período no puede iniciar antes de la fecha configurada.');
        }

        // La fila del período ya está bloqueada. Las escrituras de habilitaciones
        // toman este mismo bloqueo antes de sus cambios, serializando ambas operaciones.
        const pendingRows = await manager.query(
          `SELECT "id" FROM "estudiante_habilitado"
           WHERE "periodo_id" = $1
             AND "condicion_ingreso" = 'CONDICIONADO'
             AND "situacion_ingreso" = 'PENDIENTE'
           ORDER BY "id" ASC`,
          [id],
        ) as Array<{ id: string }>;
        if (pendingRows.length > 0) {
          throw new ConflictException(
            `No se puede iniciar el período: existen ${pendingRows.length} estudiantes condicionados pendientes de resolución.`,
          );
        }

        current.estado = PeriodoEstado.EN_CURSO;
        const updated = await repository.save(current);
        await this.auditoria.registrar(manager, {
          actor,
          accion: 'INICIAR_TITULACION',
          entidad_tipo: 'periodo_titulacion',
          entidad_id: current.id,
          valores_anteriores: { estado: PeriodoEstado.POSTULACION_CERRADA },
          valores_nuevos: { estado: PeriodoEstado.EN_CURSO, fecha_inicio_titulacion: now },
          ip_origen: ip,
        });
        return updated;
      });
      return responseFrom(periodo);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      if (isCode(error, '40001') || isCode(error, '40P01')) {
        throw new ConflictException('La operación coincidió con otra actualización. Vuelve a intentarlo.');
      }
      if (isCode(error, '23514')) {
        throw new ConflictException('El período no cumple las condiciones para iniciar la titulación.');
      }
      throw new ServiceUnavailableException(
        'No se pudo iniciar el período en PostgreSQL.',
        { cause: error },
      );
    }
  }
}
