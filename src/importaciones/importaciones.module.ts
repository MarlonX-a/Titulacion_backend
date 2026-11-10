import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AcademicoModule } from '../academico/academico.module.js';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module.js';
import { ColasModule } from '../colas/colas.module.js';
import { ImportacionesController } from './importaciones.controller.js';
import { ImportacionesService } from './importaciones.service.js';
import { ImportacionesWorker } from './importaciones.worker.js';
import { ImportacionesDocentesController } from './importaciones-docentes.controller.js';
import { ImportacionesDocentesService } from './importaciones-docentes.service.js';
import { ImportacionesHistorialService } from './importaciones-historial.service.js';
import { ImportacionesTemasController } from './importaciones-temas.controller.js';
import { ImportacionesTemasService } from './importaciones-temas.service.js';

@Module({
  imports: [ColasModule, BullModule.registerQueue({ name: 'importaciones' }), AuditoriaModule, AlmacenamientoModule, AcademicoModule],
  controllers: [ImportacionesController, ImportacionesDocentesController, ImportacionesTemasController],
  providers: [ImportacionesService, ImportacionesDocentesService, ImportacionesHistorialService, ImportacionesTemasService, ImportacionesWorker],
})
export class ImportacionesModule {}
