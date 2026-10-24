import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { AsignacionTema } from './entities/asignacion-tema.entity.js';
import { AsignacionTemaPersistenciaService } from './asignacion-tema-persistencia.service.js';
import { AsignacionTutorPersistenciaModule } from '../asignaciones-tutor/asignacion-tutor-persistencia.module.js';
import { NotificacionesModule } from '../notificaciones/notificaciones.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([AsignacionTema]), AuditoriaModule, AsignacionTutorPersistenciaModule, NotificacionesModule],
  providers: [AsignacionTemaPersistenciaService],
  exports: [AsignacionTemaPersistenciaService],
})
export class AsignacionTemaPersistenciaModule {}
