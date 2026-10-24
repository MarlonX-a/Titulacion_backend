import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notificacion } from './entities/notificacion.entity.js';
import { EntregaCorreoNotificacion } from './entities/entrega-correo-notificacion.entity.js';
import { NotificacionesController } from './notificaciones.controller.js';
import { NotificacionesPersistenciaService } from './notificaciones-persistencia.service.js';
import { NotificacionesService } from './notificaciones.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Notificacion, EntregaCorreoNotificacion])],
  controllers: [NotificacionesController],
  providers: [NotificacionesService, NotificacionesPersistenciaService],
  exports: [NotificacionesPersistenciaService],
})
export class NotificacionesModule {}
