import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { PeriodosController } from './periodos.controller.js';
import { PeriodosService } from './periodos.service.js';
import { PeriodoTitulacion } from './entities/periodo-titulacion.entity.js';
import { InicioTitulacionService } from './inicio-titulacion.service.js';
import { ArchivoPeriodoService } from './archivo-periodo.service.js';
import { HabilitadosModule } from '../habilitados/habilitados.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([PeriodoTitulacion]), AuditoriaModule, HabilitadosModule],
  controllers: [PeriodosController],
  providers: [PeriodosService, InicioTitulacionService, ArchivoPeriodoService],
})
export class PeriodosModule {}
