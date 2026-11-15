import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module.js';
import { ArchivoLimpiezaModule } from '../almacenamiento/archivo-limpieza.module.js';
import { ArchivoLimpiezaService } from '../almacenamiento/archivo-limpieza.service.js';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { ColasModule } from '../colas/colas.module.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { EstudianteDatosPat } from './entities/estudiante-datos-pat.entity.js';
import { ContenidoPatEstudiante } from './entities/contenido-pat.entity.js';
import { GeneracionPat } from './entities/generacion-pat.entity.js';
import { GeneracionesPatController, ConfigurarFormatoPatController } from './generaciones-pat.controller.js';
import { GeneracionesPatService } from './generaciones-pat.service.js';
import { GeneracionesPatWorker } from './generaciones-pat.worker.js';

const testMode = process.env.NODE_ENV === 'test';
const queues = testMode ? [] : [ColasModule, BullModule.registerQueue({ name: 'generaciones-pat' })];
const infra = testMode ? [] : [ArchivoLimpiezaModule];
const providers = testMode ? [
  { provide: getQueueToken('generaciones-pat'), useValue: { add: async () => undefined } },
  { provide: ArchivoLimpiezaService, useValue: { registrar: async () => undefined, solicitar: async () => undefined } },
] : [GeneracionesPatWorker];

@Module({
  imports: [TypeOrmModule.forFeature([Estudiante, EstudianteDatosPat, ContenidoPatEstudiante, GeneracionPat]), AlmacenamientoModule, AuditoriaModule, ...queues, ...infra],
  controllers: [GeneracionesPatController, ConfigurarFormatoPatController],
  providers: [GeneracionesPatService, ...providers],
})
export class GeneracionesPatModule {}
