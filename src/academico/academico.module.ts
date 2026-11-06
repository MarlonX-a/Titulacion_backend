import { Module } from '@nestjs/common';
import { AcademicoController } from './academico.controller.js';
import { AcademicoService } from './academico.service.js';

@Module({
  controllers: [AcademicoController],
  providers: [AcademicoService],
  exports: [AcademicoService],
})
export class AcademicoModule {}
