import { ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, EntityManager, In, QueryFailedError } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { NotificacionTipo } from '../notificaciones/enums/notificacion-canal.enum.js';
import { NotificacionesPersistenciaService } from '../notificaciones/notificaciones-persistencia.service.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { ConfirmacionPostulacionResponseDto } from './dto/confirmacion-postulacion.dto.js';
import { PostulacionConfirmacion } from './entities/postulacion-confirmacion.entity.js';
import { Postulacion } from './entities/postulacion.entity.js';
import { EstadoConfirmacion } from './enums/estado-confirmacion.enum.js';
import { EstadoPostulacion } from './enums/estado-postulacion.enum.js';
import { limiteVigencia, motivoReservaVencida, venceEn } from './reserva-tema.js';
import { ReservaTemaService, SISTEMA_RESERVA } from './reserva-tema.service.js';

interface DriverError { code?: string }

const NO_VISIBLE = 'No existe esa postulación visible para el usuario.';

type Resultado = { tipo: 'ok' } | { tipo: 'vencida'; motivo: string };

/**
 * Confirmación obligatoria de una postulación grupal (bloque 3). Cada integrante confirma o
 * rechaza su fila; todas CONFIRMADA dejan la postulación PENDIENTE (el tema sigue RESERVADO) y
 * una RECHAZADA rechaza la postulación y libera el tema. Las repeticiones son idempotentes.
 */
@Injectable()
export class ConfirmacionesPostulacionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditoria: AuditoriaService,
    private readonly notificaciones: NotificacionesPersistenciaService,
    private readonly reservas: ReservaTemaService,
  ) {}

  async listarPendientes(actor: Usuario): Promise<ConfirmacionPostulacionResponseDto[]> {
    try {
      const estudianteId = await this.estudianteId(this.dataSource.manager, actor);
      if (!estudianteId) return [];
      const s = this.schema(this.dataSource.manager);
      const ahora = new Date();
      const rows = await this.dataSource.query(
        `SELECT p."id" FROM ${s}."postulacion_confirmacion" c
           JOIN ${s}."postulacion" p ON p."id"=c."postulacion_id"
           JOIN ${s}."periodo_titulacion" pe ON pe."id"=p."periodo_id"
         WHERE c."estudiante_id"=$1 AND c."estado"='PENDIENTE' AND p."estado"='PENDIENTE_CONFIRMACION'
           AND p."fecha_postulacion" > $2 AND pe."estado"='POSTULACION_ABIERTA' AND pe."fecha_fin_postulacion" > $3
         ORDER BY p."fecha_postulacion" ASC, p."id" ASC`,
        [estudianteId, limiteVigencia(ahora), ahora],
      ) as Array<{ id: string }>;
      return await this.detalles(this.dataSource.manager, rows.map((row) => row.id), estudianteId);
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  async confirmar(postulacionId: string, actor: Usuario, ip: string | null): Promise<ConfirmacionPostulacionResponseDto> {
    return this.responder(postulacionId, actor, ip, EstadoConfirmacion.CONFIRMADA, null);
  }

  async rechazar(postulacionId: string, actor: Usuario, motivo: string | undefined, ip: string | null): Promise<ConfirmacionPostulacionResponseDto> {
    return this.responder(postulacionId, actor, ip, EstadoConfirmacion.RECHAZADA, motivo?.trim() || null);
  }

  private async responder(postulacionId: string, actor: Usuario, ip: string | null, respuesta: EstadoConfirmacion.CONFIRMADA | EstadoConfirmacion.RECHAZADA, motivo: string | null): Promise<ConfirmacionPostulacionResponseDto> {
    try {
      let estudianteId = '';
      const resultado = await this.dataSource.transaction(async (manager): Promise<Resultado> => {
        const propio = await this.estudianteId(manager, actor);
        if (!propio) throw new NotFoundException(NO_VISIBLE);
        estudianteId = propio;
        const s = this.schema(manager);
        const refs = await manager.query(
          `SELECT p."periodo_id",p."tema_id",p."grupo_id" FROM ${s}."postulacion" p
           WHERE p."id"=$1 AND EXISTS (SELECT 1 FROM ${s}."postulacion_confirmacion" c WHERE c."postulacion_id"=p."id" AND c."estudiante_id"=$2)`,
          [postulacionId, estudianteId],
        ) as Array<{ periodo_id: string; tema_id: string; grupo_id: string | null }>;
        const ref = refs[0];
        if (!ref) throw new NotFoundException(NO_VISIBLE);
        // Orden de bloqueo de la creación: período → tema → grupo → postulación → confirmaciones.
        const periodo = await manager.getRepository(PeriodoTitulacion).findOne({ where: { id: ref.periodo_id }, lock: { mode: 'pessimistic_write' } });
        if (!periodo) throw new NotFoundException(NO_VISIBLE);
        await manager.query(`SELECT 1 FROM ${s}."tema" WHERE "id"=$1 FOR UPDATE`, [ref.tema_id]);
        if (ref.grupo_id) await manager.query(`SELECT 1 FROM ${s}."grupo" WHERE "id"=$1 FOR UPDATE`, [ref.grupo_id]);
        await manager.query(`SELECT 1 FROM ${s}."postulacion" WHERE "id"=$1 FOR UPDATE`, [postulacionId]);
        await manager.query(`SELECT 1 FROM ${s}."postulacion_confirmacion" WHERE "postulacion_id"=$1 ORDER BY "id" FOR UPDATE`, [postulacionId]);

        const item = await manager.getRepository(Postulacion).findOneOrFail({ where: { id: postulacionId } });
        const filas = await manager.getRepository(PostulacionConfirmacion).find({ where: { postulacion_id: postulacionId }, order: { id: 'ASC' } });
        const mia = filas.find((fila) => fila.estudiante_id === estudianteId);
        if (!mia) throw new NotFoundException(NO_VISIBLE);
        if (mia.estado === respuesta) return { tipo: 'ok' };
        if (item.estado !== EstadoPostulacion.PENDIENTE_CONFIRMACION) {
          throw new ConflictException(`La postulación ya no espera confirmaciones (estado: ${item.estado}).`);
        }
        if (mia.estado === EstadoConfirmacion.CONFIRMADA) {
          throw new ConflictException('Ya confirmaste esta postulación; si el grupo no desea continuar, el representante puede cancelarla.');
        }
        const ahora = new Date();
        const vencida = motivoReservaVencida(item.fecha_postulacion, periodo, ahora);
        if (vencida) {
          await this.reservas.expirar(manager, { id: item.id, tema_id: ref.tema_id, observacion: item.observacion }, vencida, SISTEMA_RESERVA);
          return { tipo: 'vencida', motivo: vencida };
        }

        await manager.getRepository(PostulacionConfirmacion).update({ id: mia.id }, { estado: respuesta, respondida_en: ahora, motivo: respuesta === EstadoConfirmacion.RECHAZADA ? motivo : null });
        await this.auditoria.registrar(manager, {
          actor, accion: respuesta === EstadoConfirmacion.CONFIRMADA ? 'CONFIRMAR_POSTULACION' : 'RECHAZAR_POSTULACION_INTEGRANTE',
          entidad_tipo: 'postulacion', entidad_id: item.id,
          valores_anteriores: { estudiante_id: estudianteId, confirmacion: EstadoConfirmacion.PENDIENTE },
          valores_nuevos: { estudiante_id: estudianteId, confirmacion: respuesta, respondida_en: ahora, ...(motivo && respuesta === EstadoConfirmacion.RECHAZADA ? { motivo } : {}) },
          ip_origen: ip,
        });

        if (respuesta === EstadoConfirmacion.RECHAZADA) {
          const observacion = `Rechazada por un integrante del grupo (${actor.nombres} ${actor.apellidos})${motivo ? `: ${motivo}` : '.'}`;
          await manager.getRepository(Postulacion).update({ id: item.id }, { estado: EstadoPostulacion.RECHAZADA, observacion });
          await this.auditoria.registrar(manager, {
            actor, accion: 'RECHAZAR_POSTULACION_POR_INTEGRANTE', entidad_tipo: 'postulacion', entidad_id: item.id,
            valores_anteriores: { estado: item.estado, observacion: item.observacion },
            valores_nuevos: { estado: EstadoPostulacion.RECHAZADA, observacion }, ip_origen: ip,
          });
          await this.notificaciones.postulacion(manager, item.id, NotificacionTipo.POSTULACION_RECHAZADA, actor.id);
          await this.reservas.liberarSiCorresponde(manager, ref.tema_id, { actor, ip }, observacion);
          return { tipo: 'ok' };
        }

        const restantes = filas.filter((fila) => fila.id !== mia.id && fila.estado !== EstadoConfirmacion.CONFIRMADA);
        if (restantes.length === 0) {
          await manager.getRepository(Postulacion).update({ id: item.id }, { estado: EstadoPostulacion.PENDIENTE });
          await this.auditoria.registrar(manager, {
            actor, accion: 'CONFIRMAR_POSTULACION_COMPLETA', entidad_tipo: 'postulacion', entidad_id: item.id,
            valores_anteriores: { estado: EstadoPostulacion.PENDIENTE_CONFIRMACION },
            valores_nuevos: { estado: EstadoPostulacion.PENDIENTE }, ip_origen: ip,
          });
          await this.notificaciones.postulacion(manager, item.id, NotificacionTipo.POSTULACION_REGISTRADA, actor.id);
        }
        return { tipo: 'ok' };
      });
      if (resultado.tipo === 'vencida') throw new ConflictException(`La reserva venció: ${resultado.motivo}`);
      const [detalle] = await this.detalles(this.dataSource.manager, [postulacionId], estudianteId);
      if (!detalle) throw new NotFoundException(NO_VISIBLE);
      return detalle;
    } catch (error: unknown) { this.handleDatabaseError(error); }
  }

  /** Arma las respuestas en lote (postulación, tema, grupo, representante y confirmaciones). */
  private async detalles(manager: EntityManager, ids: string[], estudianteId: string): Promise<ConfirmacionPostulacionResponseDto[]> {
    if (!ids.length) return [];
    const items = await manager.getRepository(Postulacion).find({ where: { id: In(ids) }, relations: { periodo: true, tema: true, grupo: true, registrada_por: true } });
    const filas = await manager.getRepository(PostulacionConfirmacion).find({ where: { postulacion_id: In(ids) }, relations: { estudiante: { usuario: true } }, order: { creado_en: 'ASC', id: 'ASC' } });
    const porId = new Map(items.map((item) => [item.id, item]));
    return ids.flatMap((id) => {
      const item = porId.get(id);
      if (!item) return [];
      const propias = filas.filter((fila) => fila.postulacion_id === id);
      const mia = propias.find((fila) => fila.estudiante_id === estudianteId);
      if (!mia) return [];
      return [{
        postulacion_id: item.id, periodo_id: item.periodo.id, estado_postulacion: item.estado,
        fecha_postulacion: item.fecha_postulacion, vence_en: venceEn(item.fecha_postulacion),
        tema: { id: item.tema.id, titulo: item.tema.titulo, tipo: item.tema.tipo, estado: item.tema.estado },
        grupo: item.grupo ? { id: item.grupo.id, nombre: item.grupo.nombre } : null,
        representante: { id: item.registrada_por.id, nombres: item.registrada_por.nombres, apellidos: item.registrada_por.apellidos },
        mi_confirmacion: { estado: mia.estado, respondida_en: mia.respondida_en },
        confirmaciones: propias.map((fila) => ({
          estudiante_id: fila.estudiante_id, nombres: fila.estudiante?.usuario.nombres ?? '', apellidos: fila.estudiante?.usuario.apellidos ?? '',
          estado: fila.estado, respondida_en: fila.respondida_en,
        })),
      }];
    });
  }

  private async estudianteId(manager: EntityManager, actor: Usuario): Promise<string | null> {
    const estudiante = await manager.getRepository(Estudiante).findOne({ where: { usuario: { id: actor.id } } });
    return estudiante?.id ?? null;
  }

  private schema(manager: EntityManager): string {
    const schema = (manager.connection.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new ServiceUnavailableException('El esquema PostgreSQL configurado no es válido.');
    return `"${schema}"`;
  }

  private handleDatabaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (error instanceof QueryFailedError) {
      const code = (error.driverError as DriverError).code;
      if (code === '40001' || code === '40P01') throw new ConflictException('La operación coincidió con otra actualización. Vuelve a intentarlo.');
      if (code === '23514') throw new ConflictException('La confirmación incumple una regla de la postulación.');
    }
    throw new ServiceUnavailableException('No fue posible completar la confirmación de la postulación.');
  }
}
