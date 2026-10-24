import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module.js';
import { ArchivoLimpiezaModule } from '../almacenamiento/archivo-limpieza.module.js';
import { ArchivoLimpiezaService } from '../almacenamiento/archivo-limpieza.service.js';
import { ColasModule } from '../colas/colas.module.js';
import { ReportesModule } from '../reportes/reportes.module.js';
import { SolicitudExportacion } from './entities/solicitud-exportacion.entity.js';
import { ExportacionesController } from './exportaciones.controller.js';
import { ExportacionesService } from './exportaciones.service.js';
import { ExportacionesWorker } from './exportaciones.worker.js';

const testMode = process.env.NODE_ENV === 'test';
const queueModules = testMode ? [] : [ColasModule, BullModule.registerQueue({ name: 'exportaciones' })];
const infrastructureModules = testMode ? [] : [ArchivoLimpiezaModule];
const providers = testMode
  ? [
      { provide: getQueueToken('exportaciones'), useValue: { add: async () => undefined } },
      { provide: ArchivoLimpiezaService, useValue: { registrar: async () => undefined, solicitar: async () => undefined } },
    ]
  : [ExportacionesWorker];

@Module({
  imports: [TypeOrmModule.forFeature([SolicitudExportacion]), ReportesModule, AuditoriaModule, AlmacenamientoModule, ...queueModules, ...infrastructureModules],
  controllers: [ExportacionesController],
  providers: [ExportacionesService, ...providers],
  exports: [ExportacionesService],
})
export class ExportacionesModule {}
