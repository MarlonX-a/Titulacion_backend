import { Module } from '@nestjs/common';
import { AlmacenamientoService } from './almacenamiento.service.js';

@Module({ providers: [AlmacenamientoService], exports: [AlmacenamientoService] })
export class AlmacenamientoModule {}
