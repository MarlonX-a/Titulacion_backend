import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { Invitacion } from './entities/invitacion.entity.js';
import { InvitacionPersistenciaService } from './invitacion-persistencia.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Invitacion]), AuditoriaModule],
  providers: [InvitacionPersistenciaService],
  exports: [InvitacionPersistenciaService],
})
export class InvitacionPersistenciaModule {}
