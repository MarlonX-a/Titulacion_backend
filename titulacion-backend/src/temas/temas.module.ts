import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { Docente } from '../docentes/entities/docente.entity.js';
import { TemaHistorial } from './entities/tema-historial.entity.js';
import { Tema } from './entities/tema.entity.js';
import { TemasController } from './temas.controller.js';
import { TemasService } from './temas.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Tema, TemaHistorial, Docente]), AuditoriaModule],
  controllers: [TemasController],
  providers: [TemasService],
})
export class TemasModule {}
