import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { EstudiantesModule } from '../estudiantes/estudiantes.module.js';
import { HabilitadosModule } from '../habilitados/habilitados.module.js';
import { InvitacionPersistenciaModule } from '../invitaciones/invitacion-persistencia.module.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { GrupoIntegrante } from './entities/grupo-integrante.entity.js';
import { Grupo } from './entities/grupo.entity.js';
import { GruposController } from './grupos.controller.js';
import { GruposService } from './grupos.service.js';
import { GrupoGestionService } from './grupo-gestion.service.js';
import { PostulacionesPersistenciaModule } from '../postulaciones/postulaciones-persistencia.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([Grupo, GrupoIntegrante, Estudiante]), EstudiantesModule, HabilitadosModule, AuditoriaModule, InvitacionPersistenciaModule, PostulacionesPersistenciaModule],
  controllers: [GruposController],
  providers: [GruposService, GrupoGestionService],
  exports: [GruposService, GrupoGestionService],
})
export class GruposModule {}
