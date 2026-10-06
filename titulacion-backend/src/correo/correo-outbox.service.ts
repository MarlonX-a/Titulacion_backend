import { InjectQueue } from '@nestjs/bullmq';
import { ConflictException, Injectable, OnModuleDestroy, OnModuleInit, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { DataSource, IsNull, LessThanOrEqual, MoreThan } from 'typeorm';
import { CorreoSalida } from '../auth/entities/correo-salida.entity.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';

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
}
