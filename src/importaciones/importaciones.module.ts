import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module.js';
import { ColasModule } from '../colas/colas.module.js';
import { ImportacionesController } from './importaciones.controller.js';
import { ImportacionesService } from './importaciones.service.js';
import { ImportacionesWorker } from './importaciones.worker.js';
import { ImportacionesDocentesController } from './importaciones-docentes.controller.js';
import { ImportacionesDocentesService } from './importaciones-docentes.service.js';
import { ImportacionesHistorialService } from './importaciones-historial.service.js';

@Module({
  imports: [ColasModule, BullModule.registerQueue({ name: 'importaciones' }), AuditoriaModule, AlmacenamientoModule],
  controllers: [ImportacionesController, ImportacionesDocentesController],
  providers: [ImportacionesService, ImportacionesDocentesService, ImportacionesHistorialService, ImportacionesWorker],
})
export class ImportacionesModule {}
