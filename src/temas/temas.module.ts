import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { AsignacionTema } from '../asignaciones-tema/entities/asignacion-tema.entity.js';
import { NotificacionesModule } from '../notificaciones/notificaciones.module.js';
import { Postulacion } from '../postulaciones/entities/postulacion.entity.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { EstudianteHabilitado } from '../habilitados/entities/estudiante-habilitado.entity.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { TemaHistorial } from './entities/tema-historial.entity.js';
import { Tema } from './entities/tema.entity.js';
import { TemasController } from './temas.controller.js';
import { TemasService } from './temas.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Tema, TemaHistorial, Docente, Estudiante, EstudianteHabilitado, PeriodoTitulacion, Postulacion, AsignacionTema]), AuditoriaModule, NotificacionesModule],
  controllers: [TemasController],
  providers: [TemasService],
  exports: [TemasService],
})
export class TemasModule {}
