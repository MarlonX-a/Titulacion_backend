import { Module } from '@nestjs/common';
import { AuditoriaService } from './auditoria.service.js';

@Module({
  providers: [AuditoriaService],
  exports: [AuditoriaService],
})
export class AuditoriaModule {}
