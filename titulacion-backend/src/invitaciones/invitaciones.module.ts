import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { EstudiantesModule } from '../estudiantes/estudiantes.module.js';
import { HabilitadosModule } from '../habilitados/habilitados.module.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { GruposModule } from '../grupos/grupos.module.js';
import { Invitacion } from './entities/invitacion.entity.js';
import { InvitacionesController } from './invitaciones.controller.js';
import { InvitacionesService } from './invitaciones.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Invitacion, Estudiante]), EstudiantesModule, HabilitadosModule, GruposModule, AuditoriaModule],
  controllers: [InvitacionesController],
  providers: [InvitacionesService],
})
export class InvitacionesModule {}
