import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module.js';
import { ArchivoLimpiezaModule } from '../almacenamiento/archivo-limpieza.module.js';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { PlantillaPat } from '../plantillas-pat/entities/plantilla-pat.entity.js';
import { DocumentoPat } from './entities/documento-pat.entity.js';
import { RevisionPat } from '../revisiones-pat/entities/revision-pat.entity.js';
import { DocumentoPatUploadInterceptor } from './documento-pat-upload.interceptor.js';
import { DocumentosPatController } from './documentos-pat.controller.js';
import { DocumentosPatService } from './documentos-pat.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentoPat, PlantillaPat, RevisionPat]), AlmacenamientoModule, ArchivoLimpiezaModule, AuditoriaModule],
  controllers: [DocumentosPatController],
  providers: [DocumentosPatService, DocumentoPatUploadInterceptor],
  exports: [DocumentosPatService],
})
export class DocumentosPatModule {}
