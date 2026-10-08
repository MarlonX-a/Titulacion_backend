import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { LessThan, Repository } from 'typeorm';
import { ArchivoPendiente } from './entities/archivo-pendiente.entity.js';

@Injectable()
export class ArchivoLimpiezaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ArchivoLimpiezaService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(ArchivoPendiente) private readonly repository: Repository<ArchivoPendiente>,
    @InjectQueue('limpieza-archivos') private readonly queue: Queue,
  ) {}

  async registrar(periodoId: string, key: string): Promise<void> {
    await this.repository.save(this.repository.create({ periodo_id: periodoId, ruta_almacenamiento: key, estado: 'SUBIENDO' }));
  }

  async solicitar(manager: import('typeorm').EntityManager | undefined, key: string): Promise<void> {
    try {
      const repository = manager?.getRepository(ArchivoPendiente) ?? this.repository;
      await repository.update({ ruta_almacenamiento: key }, { estado: 'LIMPIEZA' });
      await this.queue.add('limpiar-archivo-no-referenciado', { key }, {
        attempts: 8, backoff: { type: 'exponential', delay: 2_000 }, removeOnComplete: true,
      });
    } catch {
      // El registro persistido se vuelve a encolar por el barrido periódico.
      this.logger.warn('No se pudo encolar una limpieza; queda pendiente para reintento automático.');
    }
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.encolarPendientes(), 30_000);
    this.timer.unref();
    void this.encolarPendientes();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async encolarPendientes(): Promise<void> {
    try {
      const oldUploads = new Date(Date.now() - 60 * 60_000);
      const pending = await this.repository.find({
        where: [
          { estado: 'LIMPIEZA' },
          { estado: 'SUBIENDO', creado_en: LessThan(oldUploads) },
        ],
        take: 100,
      });
      for (const item of pending) {
        await this.queue.add('limpiar-archivo-no-referenciado', { key: item.ruta_almacenamiento }, {
          attempts: 8, backoff: { type: 'exponential', delay: 2_000 }, removeOnComplete: true,
        });
      }
    } catch {
      // La próxima pasada reintentará cuando PostgreSQL y Redis estén disponibles.
    }
  }
}
