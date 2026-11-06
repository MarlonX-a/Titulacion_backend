import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  COLA_TRANSICIONES_PERIODO,
  JOB_TRANSICIONES_PERIODO,
  TransicionesPeriodoService,
} from './transiciones-periodo.service.js';

@Processor(COLA_TRANSICIONES_PERIODO)
export class TransicionesPeriodoWorker extends WorkerHost {
  constructor(private readonly transiciones: TransicionesPeriodoService) { super(); }

  async process(job: Job): Promise<void> {
    if (job.name === JOB_TRANSICIONES_PERIODO) await this.transiciones.ejecutar();
  }
}
