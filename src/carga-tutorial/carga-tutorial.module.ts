import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { ConfigCargaTutorial } from './entities/config-carga-tutorial.entity.js';
import { CargaTutorialPersistenciaModule } from './carga-tutorial-persistencia.module.js';
import { CargaTutorialController } from './carga-tutorial.controller.js';
import { CargaTutorialService } from './carga-tutorial.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConfigCargaTutorial, PeriodoTitulacion, Docente]),
    AuditoriaModule,
    CargaTutorialPersistenciaModule,
  ],
  controllers: [CargaTutorialController],
  providers: [CargaTutorialService],
  exports: [CargaTutorialPersistenciaModule],
})
export class CargaTutorialModule {}
