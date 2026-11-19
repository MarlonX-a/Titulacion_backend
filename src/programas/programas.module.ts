import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AcademicoModule } from '../academico/academico.module.js';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { Programa } from './entities/programa.entity.js';
import { ProgramasController } from './programas.controller.js';
import { ProgramasService } from './programas.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Programa]), AuditoriaModule, AcademicoModule],
  controllers: [ProgramasController],
  providers: [ProgramasService],
  exports: [ProgramasService],
})
export class ProgramasModule {}
