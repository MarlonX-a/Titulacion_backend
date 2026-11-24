import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { AsignacionTemaPersistenciaModule } from '../asignaciones-tema/asignacion-tema-persistencia.module.js';
import { CargaTutorialPersistenciaModule } from '../carga-tutorial/carga-tutorial-persistencia.module.js';
import { HabilitadosModule } from '../habilitados/habilitados.module.js';
import { NotificacionesModule } from '../notificaciones/notificaciones.module.js';
import { PostulacionesPersistenciaModule } from '../postulaciones/postulaciones-persistencia.module.js';
import { EquiposConsultaService } from './equipos-consulta.service.js';
import { EquiposController } from './equipos.controller.js';
import { EquiposService } from './equipos.service.js';

/** Conformación administrativa de equipos (grupo o individual) con tema y candidatos a tutor. */
@Module({
  imports: [AuditoriaModule, AsignacionTemaPersistenciaModule, CargaTutorialPersistenciaModule, HabilitadosModule, NotificacionesModule, PostulacionesPersistenciaModule],
  controllers: [EquiposController],
  providers: [EquiposService, EquiposConsultaService],
  exports: [EquiposService],
})
export class EquiposModule {}
