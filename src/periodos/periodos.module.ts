import { BullModule, getQueueToken } from '@nestjs/bullmq';
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

const testMode = process.env.NODE_ENV === 'test';
const queueModules = testMode ? [] : [ColasModule, BullModule.registerQueue({ name: COLA_TRANSICIONES_PERIODO })];
const queueProviders = testMode
  ? [{ provide: getQueueToken(COLA_TRANSICIONES_PERIODO), useValue: { upsertJobScheduler: async () => undefined } }]
  : [TransicionesPeriodoWorker];

@Module({
  imports: [TypeOrmModule.forFeature([PeriodoTitulacion]), AuditoriaModule, AcademicoModule, HabilitadosModule, ConflictosModule, ...queueModules],
  controllers: [PeriodosController],
  providers: [PeriodosService, InicioTitulacionService, ArchivoPeriodoService, ResumenPeriodoService, TransicionesPeriodoService, ...queueProviders],
})
export class PeriodosModule {}
