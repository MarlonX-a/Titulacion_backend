import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { CargaTutorialPersistenciaModule } from '../carga-tutorial/carga-tutorial-persistencia.module.js';
import { AsignacionTema } from '../asignaciones-tema/entities/asignacion-tema.entity.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { GrupoIntegrante } from '../grupos/entities/grupo-integrante.entity.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { TutorPropuesto } from '../postulaciones/entities/tutor-propuesto.entity.js';
import { AsignacionTutor } from './entities/asignacion-tutor.entity.js';
import { AsignacionTutorPersistenciaModule } from './asignacion-tutor-persistencia.module.js';
import { AsignacionesTutorController } from './asignaciones-tutor.controller.js';
import { AsignacionesTutorService } from './asignaciones-tutor.service.js';
import { NotificacionesModule } from '../notificaciones/notificaciones.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([AsignacionTutor, AsignacionTema, PeriodoTitulacion, Docente, Estudiante, GrupoIntegrante, TutorPropuesto]),
    AuditoriaModule,
    CargaTutorialPersistenciaModule,
    AsignacionTutorPersistenciaModule,
    NotificacionesModule,
  ],
  controllers: [AsignacionesTutorController],
  providers: [AsignacionesTutorService],
})
export class AsignacionesTutorModule {}
