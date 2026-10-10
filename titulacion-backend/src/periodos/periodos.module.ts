import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { PeriodosController } from './periodos.controller.js';
import { PeriodosService } from './periodos.service.js';
import { PeriodoTitulacion } from './entities/periodo-titulacion.entity.js';
import { InicioTitulacionService } from './inicio-titulacion.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([PeriodoTitulacion]), AuditoriaModule],
  controllers: [PeriodosController],
  providers: [PeriodosService, InicioTitulacionService],
})
export class PeriodosModule {}
