import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { NotificacionTipo } from '../notificaciones/enums/notificacion-canal.enum.js';
import { NotificacionesPersistenciaService } from '../notificaciones/notificaciones-persistencia.service.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { TemaHistorial } from '../temas/entities/tema-historial.entity.js';
import { Tema } from '../temas/entities/tema.entity.js';
import { EstadoTema } from '../temas/enums/estado-tema.enum.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { Postulacion } from './entities/postulacion.entity.js';
import { EstadoPostulacion } from './enums/estado-postulacion.enum.js';
import { MOTIVO_VENCIDA_CIERRE, limiteVigencia, motivoReservaVencida } from './reserva-tema.js';

/** Quién origina un cambio de reserva: un usuario o el sistema (vencimientos automáticos). */
export interface ResponsableReserva { actor: Usuario | null; ip: string | null }

export const SISTEMA_RESERVA: ResponsableReserva = { actor: null, ip: null };

export const MOTIVO_ARCHIVO = 'Período archivado sin asignación.';

export interface ResumenVencimientos { expiradas: number; fallidas: number }

interface PostulacionReserva { id: string; tema_id: string; observacion: string | null }

/** Postulaciones que retienen un tema (estados que lo dejan RESERVADO). */
const ESTADOS_QUE_RESERVAN = `'PENDIENTE_CONFIRMACION','PENDIENTE','EN_CONFLICTO'`;

/**
 * Reserva de temas (bloque 3): una postulación PENDIENTE_CONFIRMACION o PENDIENTE deja su tema en
 * RESERVADO. Este servicio centraliza reservar, liberar y vencer reservas para que todos los flujos
 * (creación, confirmación, cancelación, cierre de postulación, archivo y barrido periódico) dejen
 * tema, postulación, historial y auditoría coherentes. Orden de bloqueo: período → tema → postulación.
 */
@Injectable()
export class ReservaTemaService {
  private readonly logger = new Logger(ReservaTemaService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly auditoria: AuditoriaService,
    private readonly notificaciones: NotificacionesPersistenciaService,
  ) {}

  private schema(manager: EntityManager): string {
    const schema = (manager.connection.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('El esquema PostgreSQL configurado no es válido.');
    return `"${schema}"`;
  }

  /** PUBLICADO → RESERVADO de un tema ya bloqueado por el llamador, con historial y auditoría. */
  async reservar(manager: EntityManager, temaId: string, postulacionId: string, actor: Usuario, ip: string | null): Promise<void> {
    await manager.getRepository(Tema).update({ id: temaId }, { estado: EstadoTema.RESERVADO });
    await this.historial(manager, temaId, actor, EstadoTema.PUBLICADO, EstadoTema.RESERVADO, { postulacion_id: postulacionId, motivo: 'Reserva por postulación.' });
    await this.auditoria.registrar(manager, {
      actor, accion: 'RESERVAR_TEMA', entidad_tipo: 'tema', entidad_id: temaId,
      valores_anteriores: { estado: EstadoTema.PUBLICADO }, valores_nuevos: { estado: EstadoTema.RESERVADO, postulacion_id: postulacionId }, ip_origen: ip,
    });
  }

  /**
   * RESERVADO → PUBLICADO cuando ninguna otra postulación activa (de un período no archivado)
   * retiene el tema. Devuelve si lo liberó. Bloquea el tema (idempotente si ya lo tenía el llamador).
   */
  async liberarSiCorresponde(manager: EntityManager, temaId: string, responsable: ResponsableReserva, motivo: string): Promise<boolean> {
    const s = this.schema(manager);
    const temas = await manager.query(`SELECT "estado"::text AS estado FROM ${s}."tema" WHERE "id"=$1 FOR UPDATE`, [temaId]) as Array<{ estado: string }>;
    if (temas[0]?.estado !== EstadoTema.RESERVADO) return false;
    const activas = await manager.query(
      `SELECT count(*)::int AS total FROM ${s}."postulacion" p WHERE p."tema_id"=$1 AND p."estado" IN (${ESTADOS_QUE_RESERVAN})
       AND NOT EXISTS (SELECT 1 FROM ${s}."periodo_titulacion" pe WHERE pe."id"=p."periodo_id" AND pe."estado"='ARCHIVADO')`,
      [temaId],
    ) as Array<{ total: number }>;
    if (Number(activas[0]?.total ?? 0) > 0) return false;
    await manager.getRepository(Tema).update({ id: temaId }, { estado: EstadoTema.PUBLICADO });
    await this.historial(manager, temaId, responsable.actor, EstadoTema.RESERVADO, EstadoTema.PUBLICADO, { motivo });
    await this.auditoria.registrar(manager, {
      actor: responsable.actor, accion: 'LIBERAR_TEMA_RESERVA', entidad_tipo: 'tema', entidad_id: temaId,
      valores_anteriores: { estado: EstadoTema.RESERVADO },
      valores_nuevos: { estado: EstadoTema.PUBLICADO, motivo, ...(responsable.actor ? {} : { automatico: true }) },
      ip_origen: responsable.ip,
    });
    return true;
  }

  /** PENDIENTE_CONFIRMACION → CANCELADA (fila bloqueada por el llamador), aviso y liberación del tema. */
  async expirar(manager: EntityManager, item: PostulacionReserva, motivo: string, responsable: ResponsableReserva): Promise<void> {
    await this.cancelarReserva(manager, item, motivo, responsable, EstadoPostulacion.PENDIENTE_CONFIRMACION, 'EXPIRAR_RESERVA_POSTULACION');
  }

  /** Vence, dentro del cierre de postulación (período ya bloqueado), las reservas aún sin confirmar. */
  async expirarPorCierre(manager: EntityManager, periodoId: string, responsable: ResponsableReserva): Promise<number> {
    const items = await this.bloquearDelPeriodo(manager, periodoId, [EstadoPostulacion.PENDIENTE_CONFIRMACION]);
    for (const item of items) await this.expirar(manager, item, MOTIVO_VENCIDA_CIERRE, responsable);
    return items.length;
  }

  /**
   * Antes de archivar (período ya bloqueado): las postulaciones PENDIENTE_CONFIRMACION o PENDIENTE
   * pasan a CANCELADA y liberan su tema, porque un período archivado es historial inmutable y no
   * puede retener temas del banco.
   */
  async cancelarPorArchivo(manager: EntityManager, periodoId: string, actor: Usuario, ip: string | null): Promise<number> {
    const s = this.schema(manager);
    const items = await this.bloquearDelPeriodo(manager, periodoId, [EstadoPostulacion.PENDIENTE_CONFIRMACION, EstadoPostulacion.PENDIENTE]);
    for (const item of items) {
      const rows = await manager.query(`SELECT "estado"::text AS estado FROM ${s}."postulacion" WHERE "id"=$1`, [item.id]) as Array<{ estado: EstadoPostulacion }>;
      await this.cancelarReserva(manager, item, MOTIVO_ARCHIVO, { actor, ip }, rows[0]!.estado, 'CANCELAR_POSTULACION_POR_ARCHIVO');
    }
    return items.length;
  }

  /**
   * Comprueba bajo bloqueo (período → tema → postulación) si la reserva de una postulación
   * PENDIENTE_CONFIRMACION venció y, en ese caso, la vence. Devuelve el motivo o `null`.
   */
  async expirarSiVencida(manager: EntityManager, postulacionId: string, responsable: ResponsableReserva, ahora = new Date()): Promise<string | null> {
    const s = this.schema(manager);
    const refs = await manager.query(`SELECT "periodo_id","tema_id" FROM ${s}."postulacion" WHERE "id"=$1`, [postulacionId]) as Array<{ periodo_id: string; tema_id: string }>;
    const ref = refs[0];
    if (!ref) return null;
    const periodos = await manager.query(`SELECT "estado"::text AS estado,"fecha_fin_postulacion" FROM ${s}."periodo_titulacion" WHERE "id"=$1 FOR UPDATE`, [ref.periodo_id]) as Array<{ estado: PeriodoEstado; fecha_fin_postulacion: Date | string }>;
    await manager.query(`SELECT 1 FROM ${s}."tema" WHERE "id"=$1 FOR UPDATE`, [ref.tema_id]);
    const rows = await manager.query(`SELECT "estado"::text AS estado,"fecha_postulacion","observacion" FROM ${s}."postulacion" WHERE "id"=$1 FOR UPDATE`, [postulacionId]) as Array<{ estado: string; fecha_postulacion: Date | string; observacion: string | null }>;
    const row = rows[0];
    const periodo = periodos[0];
    if (!row || !periodo || row.estado !== EstadoPostulacion.PENDIENTE_CONFIRMACION || periodo.estado === PeriodoEstado.ARCHIVADO) return null;
    const motivo = motivoReservaVencida(new Date(row.fecha_postulacion), { estado: periodo.estado, fecha_fin_postulacion: new Date(periodo.fecha_fin_postulacion) }, ahora);
    if (!motivo) return null;
    await this.expirar(manager, { id: postulacionId, tema_id: ref.tema_id, observacion: row.observacion }, motivo, responsable);
    return motivo;
  }

  /**
   * Comprobación perezosa al postular a un tema RESERVADO: vence las reservas vencidas que lo
   * retienen. Devuelve si el tema quedó PUBLICADO.
   */
  async liberarReservasVencidasDelTema(manager: EntityManager, temaId: string, ahora = new Date()): Promise<boolean> {
    const s = this.schema(manager);
    const ids = await manager.query(
      `SELECT p."id" FROM ${s}."postulacion" p WHERE p."tema_id"=$1 AND p."estado"='PENDIENTE_CONFIRMACION'
       AND NOT EXISTS (SELECT 1 FROM ${s}."periodo_titulacion" pe WHERE pe."id"=p."periodo_id" AND pe."estado"='ARCHIVADO') ORDER BY p."id"`,
      [temaId],
    ) as Array<{ id: string }>;
    for (const { id } of ids) await this.expirarSiVencida(manager, id, SISTEMA_RESERVA, ahora);
    const temas = await manager.query(`SELECT "estado"::text AS estado FROM ${s}."tema" WHERE "id"=$1`, [temaId]) as Array<{ estado: string }>;
    return temas[0]?.estado === EstadoTema.PUBLICADO;
  }

  /**
   * Barrido periódico (scheduler `transiciones-periodo`): vence las reservas con más de
   * RESERVA_CONFIRMACION_HORAS o de períodos cuyo plazo terminó. Cada una en su transacción.
   */
  async expirarVencidas(ahora = new Date()): Promise<ResumenVencimientos> {
    const s = this.schema(this.dataSource.manager);
    const candidatas = await this.dataSource.query(
      `SELECT p."id" FROM ${s}."postulacion" p JOIN ${s}."periodo_titulacion" pe ON pe."id"=p."periodo_id"
       WHERE p."estado"='PENDIENTE_CONFIRMACION' AND pe."estado"<>'ARCHIVADO'
         AND (p."fecha_postulacion" <= $1 OR pe."estado"<>'POSTULACION_ABIERTA' OR pe."fecha_fin_postulacion" <= $2)
       ORDER BY p."fecha_postulacion" ASC, p."id" ASC`,
      [limiteVigencia(ahora), ahora],
    ) as Array<{ id: string }>;
    const resumen: ResumenVencimientos = { expiradas: 0, fallidas: 0 };
    for (const { id } of candidatas) {
      try {
        const motivo = await this.dataSource.transaction((manager) => this.expirarSiVencida(manager, id, SISTEMA_RESERVA, ahora));
        if (motivo) resumen.expiradas += 1;
      } catch (error: unknown) {
        resumen.fallidas += 1;
        this.logger.error(`No se pudo vencer la reserva de la postulación ${id}: ${error instanceof Error ? error.message : 'error no identificado'}.`);
      }
    }
    return resumen;
  }

  private async bloquearDelPeriodo(manager: EntityManager, periodoId: string, estados: EstadoPostulacion[]): Promise<PostulacionReserva[]> {
    const s = this.schema(manager);
    const candidatas = await manager.query(`SELECT "id","tema_id" FROM ${s}."postulacion" WHERE "periodo_id"=$1 AND "estado"::text = ANY($2::text[]) ORDER BY "id"`, [periodoId, estados]) as Array<{ id: string; tema_id: string }>;
    if (!candidatas.length) return [];
    const temaIds = [...new Set(candidatas.map((row) => row.tema_id))];
    await manager.query(`SELECT "id" FROM ${s}."tema" WHERE "id" = ANY($1::uuid[]) ORDER BY "id" FOR UPDATE`, [temaIds]);
    return await manager.query(
      `SELECT "id","tema_id","observacion" FROM ${s}."postulacion" WHERE "id" = ANY($1::uuid[]) AND "estado"::text = ANY($2::text[]) ORDER BY "id" FOR UPDATE`,
      [candidatas.map((row) => row.id), estados],
    ) as PostulacionReserva[];
  }

  private async cancelarReserva(
    manager: EntityManager,
    item: PostulacionReserva,
    motivo: string,
    responsable: ResponsableReserva,
    estadoAnterior: EstadoPostulacion,
    accion: string,
  ): Promise<void> {
    await manager.getRepository(Postulacion).update({ id: item.id }, { estado: EstadoPostulacion.CANCELADA, observacion: motivo });
    await this.auditoria.registrar(manager, {
      actor: responsable.actor, accion, entidad_tipo: 'postulacion', entidad_id: item.id,
      valores_anteriores: { estado: estadoAnterior, observacion: item.observacion },
      valores_nuevos: { estado: EstadoPostulacion.CANCELADA, observacion: motivo, ...(responsable.actor ? {} : { automatico: true }) },
      ip_origen: responsable.ip,
    });
    await this.notificaciones.postulacion(manager, item.id, NotificacionTipo.POSTULACION_CANCELADA, responsable.actor?.id ?? '');
    await this.liberarSiCorresponde(manager, item.tema_id, responsable, motivo);
  }

  private async historial(manager: EntityManager, temaId: string, actor: Usuario | null, anterior: EstadoTema, nuevo: EstadoTema, cambios: Record<string, unknown>): Promise<void> {
    const repository = manager.getRepository(TemaHistorial);
    await repository.save(repository.create({
      tema: { id: temaId } as Tema, usuario: actor ? ({ id: actor.id } as Usuario) : null,
      estado_anterior: anterior, estado_nuevo: nuevo,
      cambios: { ...cambios, ...(actor ? {} : { automatico: true }) }, fecha: new Date(),
    }));
  }
}
