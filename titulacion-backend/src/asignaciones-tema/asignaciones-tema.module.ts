import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { HabilitadosModule } from '../habilitados/habilitados.module.js';
import { GrupoIntegrante } from '../grupos/entities/grupo-integrante.entity.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { AsignacionTemaPersistenciaModule } from './asignacion-tema-persistencia.module.js';
import { AsignacionTema } from './entities/asignacion-tema.entity.js';
import { AsignacionesTemaController } from './asignaciones-tema.controller.js';
import { AsignacionesTemaService } from './asignaciones-tema.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([AsignacionTema, Estudiante, GrupoIntegrante, PeriodoTitulacion]), HabilitadosModule, AuditoriaModule, AsignacionTemaPersistenciaModule],
  controllers: [AsignacionesTemaController],
  providers: [AsignacionesTemaService],
})
export class AsignacionesTemaModule {}
