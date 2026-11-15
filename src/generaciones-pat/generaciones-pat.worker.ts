import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { GeneracionesPatService, type GeneracionJob } from './generaciones-pat.service.js';

@Processor('generaciones-pat')
export class GeneracionesPatWorker extends WorkerHost {
  constructor(private readonly service: GeneracionesPatService) { super(); }
  async process(job: Job<GeneracionJob>): Promise<void> {
    if (job.name === 'generar-pat' && job.data?.id) await this.service.procesar(job.data.id, job.data.ciclo);
  }
}
