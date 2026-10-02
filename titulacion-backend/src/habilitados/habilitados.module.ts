import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EstudiantesModule } from '../estudiantes/estudiantes.module.js';
import { Auditoria } from '../auditoria/entities/auditoria.entity.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { EstudianteHabilitado } from './entities/estudiante-habilitado.entity.js';
import { HabilitadosController } from './habilitados.controller.js';
import { HabilitadosService } from './habilitados.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([EstudianteHabilitado, PeriodoTitulacion, Auditoria]),
    EstudiantesModule,
  ],
  controllers: [HabilitadosController],
  providers: [HabilitadosService],
})
export class HabilitadosModule {}
