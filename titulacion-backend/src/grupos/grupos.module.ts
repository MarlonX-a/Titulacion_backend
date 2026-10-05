import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { EstudiantesModule } from '../estudiantes/estudiantes.module.js';
import { HabilitadosModule } from '../habilitados/habilitados.module.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { GrupoIntegrante } from './entities/grupo-integrante.entity.js';
import { Grupo } from './entities/grupo.entity.js';
import { GruposController } from './grupos.controller.js';
import { GruposService } from './grupos.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Grupo, GrupoIntegrante, Estudiante]), EstudiantesModule, HabilitadosModule, AuditoriaModule],
  controllers: [GruposController],
  providers: [GruposService],
  exports: [GruposService],
})
export class GruposModule {}
