import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { LineaInvestigacion } from './entities/linea-investigacion.entity.js';
import { LineasInvestigacionController } from './lineas-investigacion.controller.js';
import { LineasInvestigacionService } from './lineas-investigacion.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([LineaInvestigacion]), AuditoriaModule],
  controllers: [LineasInvestigacionController],
  providers: [LineasInvestigacionService],
})
export class LineasInvestigacionModule {}
