import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { ImportacionesService } from './importaciones.service.js';
import { ImportacionesDocentesService } from './importaciones-docentes.service.js';

@Processor('importaciones')
export class ImportacionesWorker extends WorkerHost {
  constructor(
    private readonly service: ImportacionesService,
    private readonly docentes: ImportacionesDocentesService,
  ) { super(); }

  async process(job: Job<{ id: string }>): Promise<void> {
    if (job.name === 'validar-excel') return this.service.validateFile(job.data.id);
    if (job.name === 'importar-estudiantes') return this.service.importConfirmed(job.data.id);
    if (job.name === 'validar-docentes') return this.docentes.validateFile(job.data.id);
    if (job.name === 'importar-docentes') return this.docentes.importConfirmed(job.data.id);
  }
}
