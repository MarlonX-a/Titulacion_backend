import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PeriodosController } from './periodos.controller.js';
import { PeriodosService } from './periodos.service.js';
import { PeriodoTitulacion } from './entities/periodo-titulacion.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([PeriodoTitulacion])],
  controllers: [PeriodosController],
  providers: [PeriodosService],
})
export class PeriodosModule {}
