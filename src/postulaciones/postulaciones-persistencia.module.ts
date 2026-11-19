import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { NotificacionesModule } from '../notificaciones/notificaciones.module.js';
import { PostulacionPersistenciaService } from './postulacion-persistencia.service.js';
import { ReservaTemaService } from './reserva-tema.service.js';

@Module({ imports: [AuditoriaModule, NotificacionesModule], providers: [PostulacionPersistenciaService, ReservaTemaService], exports: [PostulacionPersistenciaService, ReservaTemaService] })
export class PostulacionesPersistenciaModule {}
