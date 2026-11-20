import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module.js';
import { ArchivoLimpiezaModule } from '../almacenamiento/archivo-limpieza.module.js';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { ColasModule } from '../colas/colas.module.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { EstudianteDatosPat } from './entities/estudiante-datos-pat.entity.js';
import { ContenidoPatEstudiante } from './entities/contenido-pat.entity.js';
import { GeneracionPat } from './entities/generacion-pat.entity.js';
import { GeneracionesPatController, ConfigurarFormatoPatController } from './generaciones-pat.controller.js';
import { GeneracionesPatService } from './generaciones-pat.service.js';
import { GeneracionesPatWorker } from './generaciones-pat.worker.js';

// Las pruebas sin Redis sustituyen la cola y el worker en el módulo de pruebas (test/support/e2e-app.ts).
@Module({
  imports: [TypeOrmModule.forFeature([Estudiante, EstudianteDatosPat, ContenidoPatEstudiante, GeneracionPat]), AlmacenamientoModule, AuditoriaModule, ColasModule, BullModule.registerQueue({ name: 'generaciones-pat' }), ArchivoLimpiezaModule],
  controllers: [GeneracionesPatController, ConfigurarFormatoPatController],
  providers: [GeneracionesPatService, GeneracionesPatWorker],
})
export class GeneracionesPatModule {}
