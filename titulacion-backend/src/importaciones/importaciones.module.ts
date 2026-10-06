import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module.js';
import { ColasModule } from '../colas/colas.module.js';
import { ImportacionesController } from './importaciones.controller.js';
import { ImportacionesService } from './importaciones.service.js';
import { ImportacionesWorker } from './importaciones.worker.js';

@Module({
  imports: [ColasModule, BullModule.registerQueue({ name: 'importaciones' }), AuditoriaModule, AlmacenamientoModule],
  controllers: [ImportacionesController],
  providers: [ImportacionesService, ImportacionesWorker],
})
export class ImportacionesModule {}
