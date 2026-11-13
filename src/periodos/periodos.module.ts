import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AcademicoModule } from '../academico/academico.module.js';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { ColasModule } from '../colas/colas.module.js';
import { PeriodosController } from './periodos.controller.js';
import { PeriodosService } from './periodos.service.js';
import { PeriodoTitulacion } from './entities/periodo-titulacion.entity.js';
import { InicioTitulacionService } from './inicio-titulacion.service.js';
import { ArchivoPeriodoService } from './archivo-periodo.service.js';
import { HabilitadosModule } from '../habilitados/habilitados.module.js';
import { ConflictosModule } from '../conflictos/conflictos.module.js';
import { ResumenPeriodoService } from './resumen-periodo.service.js';
import { COLA_TRANSICIONES_PERIODO, TransicionesPeriodoService } from './transiciones-periodo.service.js';
import { TransicionesPeriodoWorker } from './transiciones-periodo.worker.js';

// Las pruebas sin Redis sustituyen la cola y el worker en el módulo de pruebas (test/support/e2e-app.ts).
@Module({
  imports: [TypeOrmModule.forFeature([PeriodoTitulacion]), AuditoriaModule, AcademicoModule, HabilitadosModule, ConflictosModule, ColasModule, BullModule.registerQueue({ name: COLA_TRANSICIONES_PERIODO })],
  controllers: [PeriodosController],
  providers: [PeriodosService, InicioTitulacionService, ArchivoPeriodoService, ResumenPeriodoService, TransicionesPeriodoService, TransicionesPeriodoWorker],
})
export class PeriodosModule {}
