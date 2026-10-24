import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module.js';
import { ArchivoLimpiezaModule } from '../almacenamiento/archivo-limpieza.module.js';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { EstudianteHabilitado } from '../habilitados/entities/estudiante-habilitado.entity.js';
import { PeriodoTitulacion } from '../periodos/entities/periodo-titulacion.entity.js';
import { PlantillaPat } from './entities/plantilla-pat.entity.js';
import { PlantillaPatUploadInterceptor } from './plantilla-pat-upload.interceptor.js';
import { PlantillasPatController } from './plantillas-pat.controller.js';
import { PlantillasPatService } from './plantillas-pat.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([PlantillaPat, PeriodoTitulacion, Estudiante, EstudianteHabilitado]), AlmacenamientoModule, ArchivoLimpiezaModule, AuditoriaModule],
  controllers: [PlantillasPatController],
  providers: [PlantillasPatService, PlantillaPatUploadInterceptor],
})
export class PlantillasPatModule {}
