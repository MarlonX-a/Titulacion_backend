import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module.js';
import { CorreoWorker } from './correo.worker.js';
import { CorreoOutboxService } from './correo-outbox.service.js';
import { ColasModule } from '../colas/colas.module.js';
import { CorreoAdminController } from './correo-admin.controller.js';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';

@Module({
  imports: [
    ColasModule,
    BullModule.registerQueue({ name: 'correo' }),
    AuthModule,
    AuditoriaModule,
  ],
  controllers: [CorreoAdminController],
  providers: [CorreoWorker, CorreoOutboxService],
  exports: [CorreoOutboxService],
})
export class CorreoModule {}
