import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ColasModule } from '../colas/colas.module.js';
import { AlmacenamientoModule } from './almacenamiento.module.js';
import { ArchivoLimpiezaService } from './archivo-limpieza.service.js';
import { ArchivoLimpiezaWorker } from './archivo-limpieza.worker.js';
import { ArchivoPendiente } from './entities/archivo-pendiente.entity.js';

const testMode = process.env.NODE_ENV === 'test';

@Module({
  imports: [TypeOrmModule.forFeature([ArchivoPendiente]), AlmacenamientoModule, ...(testMode ? [] : [ColasModule, BullModule.registerQueue({ name: 'limpieza-archivos' })])],
  providers: [ArchivoLimpiezaService, ...(testMode ? [{ provide: getQueueToken('limpieza-archivos'), useValue: { add: async () => undefined } }] : [ArchivoLimpiezaWorker])],
  exports: [ArchivoLimpiezaService],
})
export class ArchivoLimpiezaModule {}
