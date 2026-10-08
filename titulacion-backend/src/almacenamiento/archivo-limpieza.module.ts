import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ColasModule } from '../colas/colas.module.js';
import { AlmacenamientoModule } from './almacenamiento.module.js';
import { ArchivoLimpiezaService } from './archivo-limpieza.service.js';
import { ArchivoLimpiezaWorker } from './archivo-limpieza.worker.js';
import { ArchivoPendiente } from './entities/archivo-pendiente.entity.js';

@Module({
  imports: [ColasModule, TypeOrmModule.forFeature([ArchivoPendiente]), AlmacenamientoModule, BullModule.registerQueue({ name: 'limpieza-archivos' })],
  providers: [ArchivoLimpiezaService, ArchivoLimpiezaWorker],
  exports: [ArchivoLimpiezaService],
})
export class ArchivoLimpiezaModule {}
