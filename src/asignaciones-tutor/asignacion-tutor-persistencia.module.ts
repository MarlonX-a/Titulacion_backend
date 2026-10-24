import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { AsignacionTutor } from './entities/asignacion-tutor.entity.js';
import { AsignacionTutorPersistenciaService } from './asignacion-tutor-persistencia.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([AsignacionTutor]), AuditoriaModule],
  providers: [AsignacionTutorPersistenciaService],
  exports: [AsignacionTutorPersistenciaService],
})
export class AsignacionTutorPersistenciaModule {}
