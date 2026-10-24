import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { ImportacionesService } from './importaciones.service.js';

@Processor('importaciones')
export class ImportacionesWorker extends WorkerHost {
  constructor(private readonly service: ImportacionesService) { super(); }

  async process(job: Job<{ id: string }>): Promise<void> {
    if (job.name === 'validar-excel') return this.service.validateFile(job.data.id);
    if (job.name === 'importar-estudiantes') return this.service.importConfirmed(job.data.id);
  }
}
