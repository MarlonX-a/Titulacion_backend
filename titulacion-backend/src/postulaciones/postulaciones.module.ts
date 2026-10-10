import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { EstudiantesModule } from '../estudiantes/estudiantes.module.js';
import { GrupoIntegrante } from '../grupos/entities/grupo-integrante.entity.js';
import { HabilitadosModule } from '../habilitados/habilitados.module.js';
import { Postulacion } from './entities/postulacion.entity.js';
import { PostulacionesController } from './postulaciones.controller.js';
import { PostulacionesService } from './postulaciones.service.js';
import { InvitacionPersistenciaModule } from '../invitaciones/invitacion-persistencia.module.js';
import { TutoresPropuestosModule } from './tutores-propuestos.module.js';
import { AsignacionTemaPersistenciaModule } from '../asignaciones-tema/asignacion-tema-persistencia.module.js';
import { NotificacionesModule } from '../notificaciones/notificaciones.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([Postulacion, Estudiante, GrupoIntegrante]), EstudiantesModule, HabilitadosModule, AuditoriaModule, InvitacionPersistenciaModule, TutoresPropuestosModule, AsignacionTemaPersistenciaModule, NotificacionesModule],
  controllers: [PostulacionesController],
  providers: [PostulacionesService],
})
export class PostulacionesModule {}
