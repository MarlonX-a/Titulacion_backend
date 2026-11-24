import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { DocumentosPatModule } from '../documentos-pat/documentos-pat.module.js';
import { EquiposModule } from '../equipos/equipos.module.js';
import { GeneracionesPatModule } from '../generaciones-pat/generaciones-pat.module.js';
import { PreparacionPatInverso } from './entities/preparacion-pat-inverso.entity.js';
import { PatInversoController } from './pat-inverso.controller.js';
import { PatInversoService } from './pat-inverso.service.js';

/** Carga del Word oficial llenado, vista previa y confirmación sobre los datos PAT ya existentes. */
@Module({
  imports: [TypeOrmModule.forFeature([PreparacionPatInverso]), AuditoriaModule, EquiposModule, GeneracionesPatModule, DocumentosPatModule],
  controllers: [PatInversoController],
  providers: [PatInversoService],
})
export class PatInversoModule {}
