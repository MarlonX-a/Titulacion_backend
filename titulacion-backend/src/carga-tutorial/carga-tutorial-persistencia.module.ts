import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigCargaTutorial } from './entities/config-carga-tutorial.entity.js';
import { CargaTutorialPersistenciaService } from './carga-tutorial-persistencia.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([ConfigCargaTutorial])],
  providers: [CargaTutorialPersistenciaService],
  exports: [CargaTutorialPersistenciaService],
})
export class CargaTutorialPersistenciaModule {}
