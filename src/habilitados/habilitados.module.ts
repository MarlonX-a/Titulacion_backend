import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { EstudiantesModule } from '../estudiantes/estudiantes.module.js';
import { Auditoria } from '../auditoria/entities/auditoria.entity.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { EstudianteHabilitado } from './entities/estudiante-habilitado.entity.js';
import { HabilitadosController } from './habilitados.controller.js';
import { HabilitadosService } from './habilitados.service.js';
import { AsignacionTemaPersistenciaModule } from '../asignaciones-tema/asignacion-tema-persistencia.module.js';
import { NotificacionesModule } from '../notificaciones/notificaciones.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([EstudianteHabilitado, PeriodoTitulacion, Auditoria]),
    EstudiantesModule,
    AuditoriaModule,
    AsignacionTemaPersistenciaModule,
    NotificacionesModule,
  ],
  controllers: [HabilitadosController],
  providers: [HabilitadosService],
  exports: [HabilitadosService],
})
export class HabilitadosModule {}
