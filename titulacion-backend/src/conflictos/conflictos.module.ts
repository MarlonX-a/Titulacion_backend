import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { ConflictosController } from './conflictos.controller.js';
import { ConflictosService } from './conflictos.service.js';
import { ResolucionConflicto } from './entities/resolucion-conflicto.entity.js';
import { ConflictoParticipante } from './entities/conflicto-participante.entity.js';
import { Tema } from '../temas/entities/tema.entity.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([ResolucionConflicto, ConflictoParticipante, Tema, PeriodoTitulacion]), AuditoriaModule],
  controllers: [ConflictosController],
  providers: [ConflictosService],
})
export class ConflictosModule {}
