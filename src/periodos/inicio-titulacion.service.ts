import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { HabilitadosService } from '../habilitados/habilitados.service.js';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { HabilitadoEstado } from '../habilitados/enums/habilitado-estado.enum.js';
import { SituacionIngreso } from '../habilitados/enums/situacion-ingreso.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { PeriodoTitulacion } from './entities/periodo-titulacion.entity.js';
import { PeriodoEstado } from './enums/periodo-estado.enum.js';
import { PeriodoResponseDto } from './dto/periodo-response.dto.js';

const OBSERVACION_SUSPENSION_INICIO = 'Requisito no resuelto antes del inicio de titulación.';

interface PostgresError { code?: string; }

function isCode(error: unknown, code: string): boolean {
  return error instanceof QueryFailedError &&
    (error.driverError as PostgresError).code === code;
}

function schemaOf(manager: EntityManager): string {
  const value = (manager.connection.options as PostgresConnectionOptions).schema ?? 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('El esquema PostgreSQL configurado no es válido.');
  return `"${value}"`;
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
    private readonly habilitados: HabilitadosService,
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
        // Las consultas crudas no heredan el esquema de las entidades; se califica explícitamente.
        const schema = schemaOf(manager);
        const pendingRows = await manager.query(
          `SELECT "id", "estado", "estudiante_id" FROM ${schema}."estudiante_habilitado"
           WHERE "periodo_id" = $1
             AND "condicion_ingreso" = 'CONDICIONADO'
             AND "situacion_ingreso" = 'PENDIENTE'
           ORDER BY "id" ASC
           FOR UPDATE`,
          [id],
        ) as Array<{ id: string; estado: string; estudiante_id: string }>;

        // Los condicionados sin resolver al inicio quedan suspendidos y no admitidos;
        // se actualizan antes del cambio de estado para cumplir el trigger del período.
        // Cada uno recibe los mismos efectos que una NO_ADMISIÓN manual (anulación de su
        // asignación vigente y notificación) mientras el período sigue en POSTULACION_CERRADA.
        if (pendingRows.length > 0) {
          await manager.query(
            `UPDATE ${schema}."estudiante_habilitado"
             SET "estado" = 'SUSPENDIDO',
                 "situacion_ingreso" = 'NO_ADMITIDO',
                 "fecha_resolucion_ingreso" = $2,
                 "resuelto_por_id" = $3,
                 "observacion_ingreso" = $4
             WHERE "id" = ANY($1::uuid[])
               AND "periodo_id" = $5
               AND "condicion_ingreso" = 'CONDICIONADO'
               AND "situacion_ingreso" = 'PENDIENTE'`,
            [pendingRows.map((row) => row.id), now, actor.id, OBSERVACION_SUSPENSION_INICIO, id],
          );
          for (const row of pendingRows) {
            await this.auditoria.registrar(manager, {
              actor,
              accion: 'SUSPENDER_HABILITACION_INICIO',
              entidad_tipo: 'estudiante_habilitado',
              entidad_id: row.id,
              valores_anteriores: { estado: row.estado, situacion_ingreso: SituacionIngreso.PENDIENTE },
              valores_nuevos: {
                estado: HabilitadoEstado.SUSPENDIDO,
                situacion_ingreso: SituacionIngreso.NO_ADMITIDO,
                fecha_resolucion_ingreso: now,
                resuelto_por_id: actor.id,
                observacion_ingreso: OBSERVACION_SUSPENSION_INICIO,
              },
              ip_origen: ip,
            });
            await this.habilitados.aplicarNoAdmision(
              manager,
              { id: row.id, periodoId: id, estudianteId: row.estudiante_id },
              actor,
              ip,
              OBSERVACION_SUSPENSION_INICIO,
              'SUSPENSION_INICIO',
            );
          }
        }

        current.estado = PeriodoEstado.EN_CURSO;
        const updated = await repository.save(current);
        await this.auditoria.registrar(manager, {
          actor,
          accion: 'INICIAR_TITULACION',
          entidad_tipo: 'periodo_titulacion',
          entidad_id: current.id,
          valores_anteriores: { estado: PeriodoEstado.POSTULACION_CERRADA },
          valores_nuevos: {
            estado: PeriodoEstado.EN_CURSO,
            fecha_inicio_titulacion: now,
            condicionados_suspendidos: pendingRows.length,
          },
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
