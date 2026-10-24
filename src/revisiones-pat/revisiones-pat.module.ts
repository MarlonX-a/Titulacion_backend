import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { DocumentosPatModule } from '../documentos-pat/documentos-pat.module.js';
import { RevisionPat } from './entities/revision-pat.entity.js';
import { RevisionesPatController } from './revisiones-pat.controller.js';
import { RevisionesPatService } from './revisiones-pat.service.js';
import { NotificacionesModule } from '../notificaciones/notificaciones.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([RevisionPat]), DocumentosPatModule, AuditoriaModule, NotificacionesModule],
  controllers: [RevisionesPatController],
  providers: [RevisionesPatService],
})
export class RevisionesPatModule {}
