import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { ExportacionesService, type ExportacionJob } from './exportaciones.service.js';

@Processor('exportaciones')
export class ExportacionesWorker extends WorkerHost {
  constructor(private readonly service: ExportacionesService) { super(); }
  async process(job: Job<ExportacionJob>): Promise<void> {
    if (job.name === 'generar-exportacion' && typeof job.id === 'string') await this.service.procesar(job.data, job.id);
  }
}
