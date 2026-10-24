import { Module } from '@nestjs/common';
import { ReportesService } from './reportes.service.js';

@Module({ providers: [ReportesService], exports: [ReportesService] })
export class ReportesModule {}
