import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { NotificacionesModule } from '../notificaciones/notificaciones.module.js';
import { PostulacionPersistenciaService } from './postulacion-persistencia.service.js';

@Module({ imports: [AuditoriaModule, NotificacionesModule], providers: [PostulacionPersistenciaService], exports: [PostulacionPersistenciaService] })
export class PostulacionesPersistenciaModule {}
