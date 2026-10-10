import { InjectQueue } from '@nestjs/bullmq';
import { ConflictException, Injectable, OnModuleDestroy, OnModuleInit, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { DataSource, IsNull, LessThanOrEqual, MoreThan } from 'typeorm';
import { CorreoSalida } from '../auth/entities/correo-salida.entity.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { EntregaCorreoNotificacion } from '../notificaciones/entities/entrega-correo-notificacion.entity.js';
import { EntregaCorreoEstado } from '../notificaciones/enums/entrega-correo-estado.enum.js';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

export interface CorreoAdminItem {
  id: string;
  correo_destino: string;
  tipo: string;
  estado: 'EN_COLA' | 'FALLIDO' | 'EXPIRADO' | 'ENVIADO';
  intentos: number;
  creada_en: Date;
  expira_en: Date;
  enviado_en: Date | null;
}
export interface NotificacionCorreoAdminItem { id: string; correo_destino: string; tipo: string; titulo: string; estado: EntregaCorreoEstado; intentos: number; creada_en: Date; actualizada_en: Date; ultimo_error: string | null; enviada_en: Date | null }
@Injectable()
export class CorreoOutboxService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private dispatching = false;

  constructor(
    @InjectQueue('correo') private readonly queue: Queue,
    private readonly dataSource: DataSource,
    private readonly auditoria: AuditoriaService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.dispatchPending(), 5000);
    this.timer.unref();
    void this.dispatchPending();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
  }

  async dispatchPending(): Promise<void> {
    if (this.dispatching || !this.dataSource.isInitialized) return;
    this.dispatching = true;
    try {
      await this.dataSource.getRepository(CorreoSalida).update(
        { enviado_en: IsNull(), expira_en: LessThanOrEqual(new Date()) },
        { secreto_cifrado: '', nonce: '', tag: '' },
      );
      const pending = await this.dataSource.getRepository(CorreoSalida).find({
        where: { enviado_en: IsNull(), expira_en: MoreThan(new Date()) },
        order: { expira_en: 'ASC' }, take: 50,
      });
      for (const message of pending) {
        await this.queue.add('enviar-correo', { id: message.id }, {
          jobId: `correo-${message.id}`, attempts: 5,
          backoff: { type: 'exponential', delay: 3000 },
          removeOnComplete: true, removeOnFail: false,
        });
      }
      const s = this.schema();
      await this.dataSource.query(`UPDATE ${s}."entrega_correo_notificacion" SET "estado"=CASE WHEN "intentos">=5 THEN 'FALLIDO'::${s}."entrega_correo_estado_enum" ELSE 'PENDIENTE'::${s}."entrega_correo_estado_enum" END, "generacion_reintento"="generacion_reintento"+CASE WHEN "intentos"<5 THEN 1 ELSE 0 END, "reserva_hasta"=NULL, "reserva_token"=NULL, "actualizada_en"=CURRENT_TIMESTAMP, "ultimo_error"=CASE WHEN "intentos">=5 THEN 'La reserva expiró después de agotar los intentos.' ELSE "ultimo_error" END WHERE "estado"='PROCESANDO' AND "reserva_hasta" <= CURRENT_TIMESTAMP`);
      const notifications = await this.dataSource.getRepository(EntregaCorreoNotificacion).find({ where: { estado: EntregaCorreoEstado.PENDIENTE }, order: { creada_en: 'ASC' }, take: 50 });
      for (const delivery of notifications) {
        const jobId = `notificacion-${delivery.id}-g${delivery.generacion_reintento}`;
        const existing = await this.queue.getJob(jobId);
        if (existing) {
          const state = await existing.getState();
          if (state === 'failed' || state === 'completed') await existing.remove();
        }
        await this.queue.add('enviar-notificacion', { id: delivery.id, generation: delivery.generacion_reintento }, { jobId, attempts: 5, backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: true, removeOnFail: false });
      }
    } catch {
      // El registro de salida permanece en PostgreSQL; el siguiente ciclo reintenta publicarlo.
    } finally {
      this.dispatching = false;
    }
  }

  async listAdmin(actor: Usuario, page = 1, limit = 20): Promise<{ data: CorreoAdminItem[]; total: number; page: number; limit: number }> {
    const [items, total] = await this.dataSource.getRepository(CorreoSalida).findAndCount({
      relations: { usuario: true }, order: { expira_en: 'DESC', id: 'ASC' },
      skip: (page - 1) * limit, take: limit,
    });
    void actor;
    return { data: items.map((item) => ({
      id: item.id, correo_destino: item.usuario.email, tipo: item.tipo,
      estado: item.enviado_en ? 'ENVIADO' : item.expira_en <= new Date() ? 'EXPIRADO' : item.intentos >= 5 ? 'FALLIDO' : 'EN_COLA',
      intentos: item.intentos, creada_en: item.creada_en, expira_en: item.expira_en, enviado_en: item.enviado_en,
    })), total, page, limit };
  }

  async retry(id: string, actor: Usuario, ip: string | null): Promise<void> {
    const record = await this.dataSource.getRepository(CorreoSalida).findOneBy({ id });
    if (!record) throw new NotFoundException('No existe el correo pendiente.');
    if (record.enviado_en || record.expira_en <= new Date() || !record.secreto_cifrado) throw new ConflictException('El correo ya se envió o venció; genera una nueva solicitud de acceso.');
    const jobId = `correo-${record.id}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'failed') await existing.remove();
      else if (state === 'completed') await existing.remove();
    }
    await this.queue.add('enviar-correo', { id: record.id }, {
      jobId, attempts: 5, backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: true, removeOnFail: false,
    });
    await this.auditoria.registrar(this.dataSource.manager, { actor, accion: 'REINTENTAR_CORREO_SALIDA', entidad_tipo: 'correo_salida', entidad_id: id, valores_anteriores: null, valores_nuevos: { tipo: record.tipo, reintento_solicitado: true }, ip_origen: ip });
  }

  async listNotificationAdmin(page: number, limit: number, estado?: EntregaCorreoEstado): Promise<{ data: NotificacionCorreoAdminItem[]; total: number; page: number; limit: number }> {
    try {
      const query = this.dataSource.getRepository(EntregaCorreoNotificacion).createQueryBuilder('e')
        .innerJoinAndSelect('e.notificacion', 'n').innerJoinAndSelect('n.usuario', 'u')
        .select(['e.id', 'e.notificacion_id', 'e.estado', 'e.intentos', 'e.creada_en', 'e.actualizada_en', 'e.ultimo_error', 'e.enviada_en', 'n.id', 'n.usuario_id', 'n.tipo', 'n.titulo', 'u.id', 'u.email'])
        .orderBy('e.creada_en', 'DESC').addOrderBy('e.id', 'ASC').skip((page - 1) * limit).take(limit);
      if (estado) query.andWhere('e.estado = :estado', { estado });
      const [items, total] = await query.getManyAndCount();
      return { data: items.map((item) => ({ id: item.id, correo_destino: item.notificacion?.usuario?.email ?? '', tipo: item.notificacion?.tipo ?? '', titulo: item.notificacion?.titulo ?? '', estado: item.estado, intentos: item.intentos, creada_en: item.creada_en, actualizada_en: item.actualizada_en, ultimo_error: item.ultimo_error, enviada_en: item.enviada_en })), total, page, limit };
    } catch { throw new ServiceUnavailableException('No fue posible consultar los correos de notificación.'); }
  }

  async retryNotification(id: string, actor: Usuario, ip: string | null): Promise<void> {
    const s = this.schema();
    try {
      await this.dataSource.transaction(async (manager) => {
        const rows = await manager.query(`SELECT "estado"::text AS estado, "notificacion_id" FROM ${s}."entrega_correo_notificacion" WHERE "id"=$1 FOR UPDATE`, [id]) as Array<{ estado: EntregaCorreoEstado; notificacion_id: string }>;
        const delivery = rows[0];
        if (!delivery) throw new NotFoundException('No existe la entrega de correo indicada.');
        if (delivery.estado !== EntregaCorreoEstado.FALLIDO) throw new ConflictException('Solo se pueden reintentar correos fallidos.');
        await manager.query(`UPDATE ${s}."entrega_correo_notificacion" SET "estado"='PENDIENTE', "intentos"=0, "generacion_reintento"="generacion_reintento"+1, "reserva_hasta"=NULL, "reserva_token"=NULL, "ultimo_error"=NULL, "actualizada_en"=CURRENT_TIMESTAMP WHERE "id"=$1`, [id]);
        await this.auditoria.registrar(manager, { actor, accion: 'REINTENTAR_NOTIFICACION_EMAIL', entidad_tipo: 'notificacion', entidad_id: delivery.notificacion_id, valores_anteriores: { estado: delivery.estado }, valores_nuevos: { estado: EntregaCorreoEstado.PENDIENTE }, ip_origen: ip });
      });
    } catch (error: unknown) {
      if (error instanceof NotFoundException || error instanceof ConflictException) throw error;
      throw new ServiceUnavailableException('No fue posible reintentar la notificación por correo.');
    }
  }

  private schema(): string {
    const name = (this.dataSource.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new ServiceUnavailableException('El esquema PostgreSQL configurado no es válido.');
    return `"${name}"`;
  }
}
