import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Docente } from '../docentes/entities/docente.entity.js';
import { TemasModule } from '../temas/temas.module.js';
import { TutorPropuesto } from './entities/tutor-propuesto.entity.js';
import { TutoresPropuestosService } from './tutores-propuestos.service.js';
import { TutoresDisponiblesController } from './tutores-disponibles.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([TutorPropuesto, Docente]), TemasModule],
  controllers: [TutoresDisponiblesController],
  providers: [TutoresPropuestosService],
  exports: [TutoresPropuestosService],
})
export class TutoresPropuestosModule {}
