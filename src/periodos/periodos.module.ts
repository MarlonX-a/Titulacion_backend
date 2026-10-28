import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { PeriodosController } from './periodos.controller.js';
import { PeriodosService } from './periodos.service.js';
import { PeriodoTitulacion } from './entities/periodo-titulacion.entity.js';
import { InicioTitulacionService } from './inicio-titulacion.service.js';
import { ArchivoPeriodoService } from './archivo-periodo.service.js';
import { HabilitadosModule } from '../habilitados/habilitados.module.js';
import { ConflictosModule } from '../conflictos/conflictos.module.js';
import { ResumenPeriodoService } from './resumen-periodo.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([PeriodoTitulacion]), AuditoriaModule, HabilitadosModule, ConflictosModule],
  controllers: [PeriodosController],
  providers: [PeriodosService, InicioTitulacionService, ArchivoPeriodoService, ResumenPeriodoService],
})
export class PeriodosModule {}
