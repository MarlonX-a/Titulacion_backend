import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Docente } from './entities/docente.entity.js';
import { DocentesController } from './docentes.controller.js';
import { DocentesService } from './docentes.service.js';
import { CedulaEcuatorianaValidator } from '../common/validators/cedula-ecuatoriana.validator.js';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { UsuariosModule } from '../usuarios/usuarios.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([Docente]), UsuariosModule, AuditoriaModule],
  controllers: [DocentesController],
  providers: [DocentesService, CedulaEcuatorianaValidator],
})
export class DocentesModule {}
