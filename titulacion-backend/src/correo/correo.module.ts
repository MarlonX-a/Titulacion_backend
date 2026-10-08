import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module.js';
import { CorreoWorker } from './correo.worker.js';
import { CorreoOutboxService } from './correo-outbox.service.js';
import { ColasModule } from '../colas/colas.module.js';
import { CorreoAdminController } from './correo-admin.controller.js';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EntregaCorreoNotificacion } from '../notificaciones/entities/entrega-correo-notificacion.entity.js';
import { Notificacion } from '../notificaciones/entities/notificacion.entity.js';
import { NotificacionesModule } from '../notificaciones/notificaciones.module.js';
import { SmtpTransportService } from './smtp-transport.service.js';
import { NotificacionesCorreoAdminController } from './notificaciones-correo-admin.controller.js';

@Module({
  imports: [
    ColasModule,
    BullModule.registerQueue({ name: 'correo' }),
    AuthModule,
    AuditoriaModule,
    TypeOrmModule.forFeature([EntregaCorreoNotificacion, Notificacion]),
    NotificacionesModule,
  ],
  controllers: [CorreoAdminController, NotificacionesCorreoAdminController],
  providers: [CorreoWorker, CorreoOutboxService, SmtpTransportService],
  exports: [CorreoOutboxService],
})
export class CorreoModule {}
