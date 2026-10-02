import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Estudiante } from './entities/estudiante.entity.js';
import { EstudiantesController } from './estudiantes.controller.js';
import { EstudiantesService } from './estudiantes.service.js';
import { CedulaEcuatorianaValidator } from '../common/validators/cedula-ecuatoriana.validator.js';

@Module({
  imports: [TypeOrmModule.forFeature([Estudiante])],
  controllers: [EstudiantesController],
  providers: [EstudiantesService, CedulaEcuatorianaValidator],
})
export class EstudiantesModule {}
