import { Module } from '@nestjs/common';
import { PostulacionPersistenciaService } from './postulacion-persistencia.service.js';

@Module({ providers: [PostulacionPersistenciaService], exports: [PostulacionPersistenciaService] })
export class PostulacionesPersistenciaModule {}
