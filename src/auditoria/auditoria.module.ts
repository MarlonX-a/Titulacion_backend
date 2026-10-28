import { Module } from '@nestjs/common';
import { AuditoriaService } from './auditoria.service.js';
import { AuditoriaConsultaService } from './auditoria-consulta.service.js';
import { AuditoriaController } from './auditoria.controller.js';

@Module({
  controllers: [AuditoriaController],
  providers: [AuditoriaService, AuditoriaConsultaService],
  exports: [AuditoriaService],
})
export class AuditoriaModule {}
