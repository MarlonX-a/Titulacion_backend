import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ColasModule } from '../colas/colas.module.js';
import { AlmacenamientoModule } from './almacenamiento.module.js';
import { ArchivoLimpiezaService } from './archivo-limpieza.service.js';
import { ArchivoLimpiezaWorker } from './archivo-limpieza.worker.js';
import { ArchivoPendiente } from './entities/archivo-pendiente.entity.js';

// Las pruebas sin Redis sustituyen la cola y el worker en el módulo de pruebas (test/support/e2e-app.ts).
@Module({
  imports: [TypeOrmModule.forFeature([ArchivoPendiente]), AlmacenamientoModule, ColasModule, BullModule.registerQueue({ name: 'limpieza-archivos' })],
  providers: [ArchivoLimpiezaService, ArchivoLimpiezaWorker],
  exports: [ArchivoLimpiezaService],
})
export class ArchivoLimpiezaModule {}
