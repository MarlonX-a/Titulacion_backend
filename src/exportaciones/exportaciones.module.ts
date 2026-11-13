import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module.js';
import { ArchivoLimpiezaModule } from '../almacenamiento/archivo-limpieza.module.js';
import { ColasModule } from '../colas/colas.module.js';
import { ReportesModule } from '../reportes/reportes.module.js';
import { SolicitudExportacion } from './entities/solicitud-exportacion.entity.js';
import { ExportacionesController } from './exportaciones.controller.js';
import { ExportacionesService } from './exportaciones.service.js';
import { ExportacionesWorker } from './exportaciones.worker.js';

// Las pruebas sin Redis sustituyen la cola y el worker en el módulo de pruebas (test/support/e2e-app.ts).
@Module({
  imports: [TypeOrmModule.forFeature([SolicitudExportacion]), ReportesModule, AuditoriaModule, AlmacenamientoModule, ColasModule, BullModule.registerQueue({ name: 'exportaciones' }), ArchivoLimpiezaModule],
  controllers: [ExportacionesController],
  providers: [ExportacionesService, ExportacionesWorker],
  exports: [ExportacionesService],
})
export class ExportacionesModule {}
